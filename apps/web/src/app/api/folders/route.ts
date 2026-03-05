import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, folders, members, eq, and, asc, inArray } from '@collabmd/db'
import { writeTuple, listAccessibleObjects, checkPermission } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = await request.json()
  const { name, orgId, parentId } = body as {
    name: string
    orgId: string
    parentId?: string
  }

  if (!name || !orgId) {
    return NextResponse.json({ error: 'name and org id are required' }, { status: 400 })
  }

  const membership = db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()
  if (!membership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let path = `/${name}`

  if (parentId) {
    const parent = db.select().from(folders).where(eq(folders.id, parentId)).get()
    if (!parent) {
      return NextResponse.json({ error: 'parent folder not found' }, { status: 404 })
    }
    if (parent.orgId !== orgId) {
      return NextResponse.json(
        { error: 'parent folder belongs to a different organization' },
        { status: 400 },
      )
    }
    const canEditParent = await checkPermission(session.user.id, 'can_edit', 'folder', parentId)
    if (!canEditParent) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    path = `${parent.path}/${name}`
  }

  const id = crypto.randomUUID()
  const now = new Date()

  const folder = db
    .insert(folders)
    .values({
      id,
      orgId,
      name,
      path,
      parentId: parentId ?? null,
      createdBy: session.user.id,
      createdAt: now,
    })
    .returning()
    .get()

  await writeTuple(`user:${session.user.id}`, 'owner', `folder:${id}`)
  await writeTuple(`org:${orgId}`, 'org', `folder:${id}`)

  return NextResponse.json(folder, { status: 201 })
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const orgId = request.nextUrl.searchParams.get('orgId')
  if (!orgId) {
    return NextResponse.json({ error: 'org id is required' }, { status: 400 })
  }

  const accessible = await listAccessibleObjects(session.user.id, 'can_view', 'folder')
  const folderIds = accessible.map((obj) => obj.replace('folder:', ''))

  if (folderIds.length === 0) {
    return NextResponse.json([])
  }

  const result = db
    .select()
    .from(folders)
    .where(and(inArray(folders.id, folderIds), eq(folders.orgId, orgId)))
    .orderBy(asc(folders.position), asc(folders.path))
    .all()

  return NextResponse.json(result)
}
