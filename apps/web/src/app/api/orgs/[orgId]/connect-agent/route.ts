import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { requireJsonContentType } from '@/lib/http'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { encryptWebhookSecret } from '@/lib/webhook-secret'
import { db, agentKeys, webhooks, organizations, members, and, eq } from '@collabmd/db'

interface AgentRegistryEntry {
  name: string
  description: string
  enabled: boolean
}

function createRawAgentKey(): string {
  return `ak_${crypto.randomBytes(20).toString('hex')}`
}

function hashKey(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseAgentRegistry(value: unknown): AgentRegistryEntry[] {
  if (!Array.isArray(value)) return []
  const result: AgentRegistryEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!name) continue
    result.push({
      name,
      description: typeof candidate.description === 'string' ? candidate.description : '',
      enabled: candidate.enabled !== false,
    })
  }
  return result
}

async function requireOrgAdmin(orgId: string): Promise<
  | {
      session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
    }
  | NextResponse
> {
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
    return NextResponse.json(
      { error: 'only admins and owners can connect agents' },
      { status: 403 },
    )
  }

  return { session }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const authz = await requireOrgAdmin(orgId)
  if (authz instanceof NextResponse) return authz

  const rateLimitError = enforceUserMutationRateLimit(authz.session.user.id, {
    ip: getClientIp(request),
  })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = (await request.json()) as {
    name?: string
    description?: string
    webhookUrl?: string
  }

  const name = typeof body.name === 'string' ? body.name.trim().replace(/^@+/, '') : ''
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : ''

  // Validate webhook URL if provided
  if (webhookUrl) {
    try {
      const parsed = new URL(webhookUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return NextResponse.json({ error: 'webhookUrl must use http or https' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'webhookUrl must be a valid URL' }, { status: 400 })
    }
  }

  // 1. Create API key
  const rawKey = createRawAgentKey()
  const keyId = crypto.randomUUID()
  const createdAt = new Date()

  db.insert(agentKeys)
    .values({
      id: keyId,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, 11),
      orgId,
      name,
      scopes: JSON.stringify({}),
      createdBy: authz.session.user.id,
      createdAt,
      lastUsedAt: null,
      revokedAt: null,
    })
    .run()

  // 2. Create webhook if URL provided
  let webhookSecret: string | undefined
  if (webhookUrl) {
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`
    const encryptedSecret = encryptWebhookSecret(secret)

    db.insert(webhooks)
      .values({
        id: crypto.randomUUID(),
        orgId,
        url: webhookUrl,
        secret: encryptedSecret,
        events: JSON.stringify(['comment.mention']),
        createdBy: authz.session.user.id,
        createdAt,
        active: true,
      })
      .run()

    webhookSecret = secret
  }

  // 3. Update agent registry in org metadata
  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get()
  let existingMetadata: Record<string, unknown> = {}
  try {
    existingMetadata = org?.metadata ? JSON.parse(org.metadata) : {}
  } catch {
    // invalid JSON, start fresh
  }

  const existingAgents = parseAgentRegistry(existingMetadata.agents)
  existingAgents.push({ name, description, enabled: true })
  existingMetadata.agents = existingAgents

  db.update(organizations)
    .set({ metadata: JSON.stringify(existingMetadata) })
    .where(eq(organizations.id, orgId))
    .run()

  // 4. Determine server URL
  const serverUrl = process.env.BETTER_AUTH_URL || request.nextUrl.origin || 'http://localhost:3000'

  const response: Record<string, unknown> = {
    apiKey: rawKey,
    keyPrefix: rawKey.slice(0, 11),
    serverUrl,
    agentName: name,
  }
  if (webhookSecret) {
    response.webhookSecret = webhookSecret
  }

  return NextResponse.json(response, { status: 201 })
}
