import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, folders, eq, and, asc, inArray } from '@collabmd/db'
import { writeTuple, listAccessibleObjects } from '@collabmd/shared'

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, orgId, parentId } = body as {
    name: string
    orgId: string
    parentId?: string
  }

  if (!name || !orgId) {
    return NextResponse.json({ error: 'name and orgId are required' }, { status: 400 })
  }

  let path = `/${name}`

  if (parentId) {
    const parent = db.select().from(folders).where(eq(folders.id, parentId)).get()
    if (!parent) {
      return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 })
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgId = request.nextUrl.searchParams.get('orgId')
  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
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
    .orderBy(asc(folders.path))
    .all()

  return NextResponse.json(result)
}
