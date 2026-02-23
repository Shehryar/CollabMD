import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { db, webhooks, members, and, eq } from '@collabmd/db'

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; webhookId: string }> },
) {
  const { orgId, webhookId } = await params
  const authz = await requireOrgAdmin(orgId)
  if (authz instanceof NextResponse) return authz

  const rateLimitError = enforceUserMutationRateLimit(authz.session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const existing = db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.orgId, orgId)))
    .get()
  if (!existing) {
    return NextResponse.json({ error: 'webhook not found' }, { status: 404 })
  }

  db.delete(webhooks).where(eq(webhooks.id, webhookId)).run()
  return NextResponse.json({ ok: true })
}
