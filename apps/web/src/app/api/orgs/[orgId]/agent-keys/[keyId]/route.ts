import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { db, agentKeys, members, and, eq, isNull } from '@collabmd/db'

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
      { error: 'only admins and owners can manage api keys' },
      { status: 403 },
    )
  }

  return { session }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; keyId: string }> },
) {
  const { orgId, keyId } = await params
  const authz = await requireOrgAdmin(orgId)
  if (authz instanceof NextResponse) return authz

  const rateLimitError = enforceUserMutationRateLimit(authz.session.user.id, {
    ip: getClientIp(request),
  })
  if (rateLimitError) return rateLimitError

  const existing = db
    .select()
    .from(agentKeys)
    .where(and(eq(agentKeys.id, keyId), eq(agentKeys.orgId, orgId), isNull(agentKeys.revokedAt)))
    .get()

  if (!existing) {
    return NextResponse.json({ error: 'api key not found' }, { status: 404 })
  }

  db.update(agentKeys).set({ revokedAt: new Date() }).where(eq(agentKeys.id, keyId)).run()

  return NextResponse.json({ ok: true })
}
