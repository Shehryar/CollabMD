import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import {
  and,
  count,
  db,
  documentSnapshots,
  documents,
  eq,
  isNull,
  members,
  organizations,
} from '@collabmd/db'
import { auth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const orgId = request.nextUrl.searchParams.get('orgId') ?? session.session.activeOrganizationId
  if (!orgId) {
    return NextResponse.json({ error: 'no active organization' }, { status: 400 })
  }

  const membership = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'not a member of this organization' }, { status: 403 })
  }

  const org = db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .get()

  if (!org) {
    return NextResponse.json({ error: 'organization not found' }, { status: 404 })
  }

  const docCount = db
    .select({ count: count() })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), isNull(documents.deletedAt)))
    .get()?.count ?? 0

  const memberCount = db
    .select({ count: count() })
    .from(members)
    .where(eq(members.organizationId, orgId))
    .get()?.count ?? 0

  const daemonSnapshot = db
    .select({ id: documentSnapshots.id })
    .from(documentSnapshots)
    .innerJoin(documents, eq(documentSnapshots.documentId, documents.id))
    .where(and(eq(documents.orgId, orgId), eq(documentSnapshots.isAgentEdit, true)))
    .get()

  return NextResponse.json({
    orgId: org.id,
    orgName: org.name,
    docCount,
    memberCount,
    hasDaemonEdits: Boolean(daemonSnapshot),
  })
}
