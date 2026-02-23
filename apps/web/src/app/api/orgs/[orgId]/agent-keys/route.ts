import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { requireJsonContentType } from '@/lib/http'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { db, agentKeys, members, and, eq, isNull, desc } from '@collabmd/db'

interface AgentKeyScopesInput {
  documents?: string[]
  folders?: string[]
}

function parseScopes(value: unknown): AgentKeyScopesInput {
  if (!value || typeof value !== 'object') return {}
  const candidate = value as Record<string, unknown>
  return {
    documents: Array.isArray(candidate.documents)
      ? candidate.documents.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    folders: Array.isArray(candidate.folders)
      ? candidate.folders.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  }
}

function parseStoredScopes(value: string): AgentKeyScopesInput {
  try {
    return parseScopes(JSON.parse(value))
  } catch {
    return {}
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
    return NextResponse.json({ error: 'only admins and owners can manage api keys' }, { status: 403 })
  }

  return { session }
}

function createRawAgentKey(): string {
  return `ak_${crypto.randomBytes(20).toString('hex')}`
}

function hashKey(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const authz = await requireOrgAdmin(orgId)
  if (authz instanceof NextResponse) return authz

  const keys = db
    .select()
    .from(agentKeys)
    .where(and(eq(agentKeys.orgId, orgId), isNull(agentKeys.revokedAt)))
    .orderBy(desc(agentKeys.createdAt))
    .all()

  return NextResponse.json(keys.map((key) => ({
    id: key.id,
    keyPrefix: key.keyPrefix,
    name: key.name,
    scopes: parseStoredScopes(key.scopes),
    createdBy: key.createdBy,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
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
    name?: string
    scopes?: AgentKeyScopesInput
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const scopes = parseScopes(body.scopes)
  const rawKey = createRawAgentKey()
  const createdAt = new Date()
  const keyId = crypto.randomUUID()

  db.insert(agentKeys).values({
    id: keyId,
    keyHash: hashKey(rawKey),
    keyPrefix: rawKey.slice(0, 11),
    orgId,
    name,
    scopes: JSON.stringify(scopes),
    createdBy: authz.session.user.id,
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
  }).run()

  return NextResponse.json({
    id: keyId,
    name,
    key: rawKey,
    keyPrefix: rawKey.slice(0, 11),
    scopes,
    createdAt: createdAt.toISOString(),
  }, { status: 201 })
}
