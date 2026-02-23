import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'
import { encryptWebhookSecret } from '@/lib/webhook-secret'
import { db, webhooks, members, and, eq, desc } from '@collabmd/db'

const webhookEventTypes = [
  'document.edited',
  'comment.created',
  'comment.mention',
  'suggestion.created',
  'suggestion.accepted',
  'suggestion.dismissed',
  'discussion.created',
] as const
type WebhookEventType = (typeof webhookEventTypes)[number]

const webhookEventSet = new Set<string>(webhookEventTypes)

function parseEvents(value: unknown): WebhookEventType[] {
  if (!Array.isArray(value)) return []
  const unique = new Set<WebhookEventType>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    if (!webhookEventSet.has(entry)) continue
    unique.add(entry as WebhookEventType)
  }
  return Array.from(unique)
}

function parseStoredEvents(value: string): WebhookEventType[] {
  try {
    return parseEvents(JSON.parse(value) as unknown[])
  } catch {
    return []
  }
}

async function requireOrgAdmin(orgId: string): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
} | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'not a member of this organization' }, { status: 403 })
  }
  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return NextResponse.json({ error: 'only admins and owners can manage webhooks' }, { status: 403 })
  }

  return { session }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const authz = await requireOrgAdmin(orgId)
  if (authz instanceof NextResponse) return authz

  const rows = db
    .select()
    .from(webhooks)
    .where(eq(webhooks.orgId, orgId))
    .orderBy(desc(webhooks.createdAt))
    .all()

  return NextResponse.json(rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    url: row.url,
    events: parseStoredEvents(row.events),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    active: row.active,
  })))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const authz = await requireOrgAdmin(orgId)
  if (authz instanceof NextResponse) return authz

  const rateLimitError = enforceUserMutationRateLimit(authz.session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = await request.json() as {
    url?: string
    secret?: string
    events?: unknown[]
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'url must use http or https' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'url must be valid' }, { status: 400 })
  }

  const events = parseEvents(body.events)
  if (events.length === 0) {
    return NextResponse.json({ error: `events must include at least one of: ${webhookEventTypes.join(', ')}` }, { status: 400 })
  }

  const secret = typeof body.secret === 'string' && body.secret.trim()
    ? body.secret.trim()
    : crypto.randomBytes(32).toString('hex')
  const encryptedSecret = encryptWebhookSecret(secret)

  const created = {
    id: crypto.randomUUID(),
    orgId,
    url,
    secret: encryptedSecret,
    events: JSON.stringify(events),
    createdBy: authz.session.user.id,
    createdAt: new Date(),
    active: true,
  }

  db.insert(webhooks).values(created).run()

  return NextResponse.json({
    id: created.id,
    orgId: created.orgId,
    url: created.url,
    secret,
    events,
    createdBy: created.createdBy,
    createdAt: created.createdAt.toISOString(),
    active: created.active,
  }, { status: 201 })
}
