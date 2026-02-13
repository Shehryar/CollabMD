import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, organizations, members, eq, and } from '@collabmd/db'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

type DocPermission = 'viewer' | 'commenter' | 'editor' | 'none'
type AgentPolicy = 'enabled' | 'restricted' | 'disabled'

const validPermissions: DocPermission[] = ['viewer', 'commenter', 'editor', 'none']
const validAgentPolicies: AgentPolicy[] = ['enabled', 'restricted', 'disabled']

interface OrgSettings {
  defaultDocPermission: DocPermission
  agentPolicy: AgentPolicy
}

function parseOrgSettings(metadata: string | null): OrgSettings {
  try {
    const parsed = metadata ? JSON.parse(metadata) : {}
    const perm = validPermissions.includes(parsed.defaultDocPermission)
      ? parsed.defaultDocPermission
      : 'none'
    const policy = validAgentPolicies.includes(parsed.agentPolicy)
      ? parsed.agentPolicy
      : 'enabled'
    return { defaultDocPermission: perm, agentPolicy: policy }
  } catch {
    // invalid JSON, return defaults
  }
  return { defaultDocPermission: 'none', agentPolicy: 'enabled' }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { orgId } = await params

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'not a member of this organization' }, { status: 403 })
  }

  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return NextResponse.json({ error: 'only admins and owners can read settings' }, { status: 403 })
  }

  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get()
  if (!org) {
    return NextResponse.json({ error: 'organization not found' }, { status: 404 })
  }

  return NextResponse.json(parseOrgSettings(org.metadata))
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { orgId } = await params

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'not a member of this organization' }, { status: 403 })
  }

  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return NextResponse.json({ error: 'only admins and owners can update settings' }, { status: 403 })
  }

  const body = await request.json()
  const { defaultDocPermission, agentPolicy } = body as {
    defaultDocPermission?: string
    agentPolicy?: string
  }

  if (defaultDocPermission !== undefined && !validPermissions.includes(defaultDocPermission as DocPermission)) {
    return NextResponse.json(
      { error: `invalid permission; must be one of: ${validPermissions.join(', ')}` },
      { status: 400 },
    )
  }

  if (agentPolicy !== undefined && !validAgentPolicies.includes(agentPolicy as AgentPolicy)) {
    return NextResponse.json(
      { error: `invalid agent policy; must be one of: ${validAgentPolicies.join(', ')}` },
      { status: 400 },
    )
  }

  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get()
  if (!org) {
    return NextResponse.json({ error: 'organization not found' }, { status: 404 })
  }

  let existingMetadata: Record<string, unknown> = {}
  try {
    existingMetadata = org.metadata ? JSON.parse(org.metadata) : {}
  } catch {
    // invalid JSON, start fresh
  }

  if (defaultDocPermission !== undefined) existingMetadata.defaultDocPermission = defaultDocPermission
  if (agentPolicy !== undefined) existingMetadata.agentPolicy = agentPolicy

  db.update(organizations)
    .set({ metadata: JSON.stringify(existingMetadata) })
    .where(eq(organizations.id, orgId))
    .run()

  return NextResponse.json(parseOrgSettings(JSON.stringify(existingMetadata)))
}
