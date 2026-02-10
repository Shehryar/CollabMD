import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, organizations, members, eq, and } from '@collabmd/db'

type DocPermission = 'viewer' | 'commenter' | 'editor' | 'none'

const validPermissions: DocPermission[] = ['viewer', 'commenter', 'editor', 'none']

function parseOrgSettings(metadata: string | null): { defaultDocPermission: DocPermission } {
  try {
    const parsed = metadata ? JSON.parse(metadata) : {}
    const perm = parsed.defaultDocPermission
    if (validPermissions.includes(perm)) {
      return { defaultDocPermission: perm }
    }
  } catch {
    // invalid JSON, return default
  }
  return { defaultDocPermission: 'none' }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { orgId } = await params

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
  }

  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get()
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  return NextResponse.json(parseOrgSettings(org.metadata))
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { orgId } = await params

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
  }

  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only admins and owners can update settings' }, { status: 403 })
  }

  const body = await request.json()
  const { defaultDocPermission } = body as { defaultDocPermission: string }

  if (!validPermissions.includes(defaultDocPermission as DocPermission)) {
    return NextResponse.json(
      { error: `Invalid permission. Must be one of: ${validPermissions.join(', ')}` },
      { status: 400 },
    )
  }

  const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get()
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  let existingMetadata: Record<string, unknown> = {}
  try {
    existingMetadata = org.metadata ? JSON.parse(org.metadata) : {}
  } catch {
    // invalid JSON, start fresh
  }

  const updatedMetadata = { ...existingMetadata, defaultDocPermission }

  db.update(organizations)
    .set({ metadata: JSON.stringify(updatedMetadata) })
    .where(eq(organizations.id, orgId))
    .run()

  return NextResponse.json({ defaultDocPermission })
}
