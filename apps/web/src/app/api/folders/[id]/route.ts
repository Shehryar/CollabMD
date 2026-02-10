import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, folders, documents, eq } from '@collabmd/db'
import { checkPermission, readTuples, deleteTuple } from '@collabmd/shared'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'folder', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name } = body as { name: string }

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const existing = db.select().from(folders).where(eq(folders.id, id)).get()
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Recalculate path based on parent
  let newPath: string
  if (existing.parentId) {
    const parent = db.select().from(folders).where(eq(folders.id, existing.parentId)).get()
    newPath = parent ? `${parent.path}/${name}` : `/${name}`
  } else {
    newPath = `/${name}`
  }

  const updated = db
    .update(folders)
    .set({ name, path: newPath })
    .where(eq(folders.id, id))
    .returning()
    .get()

  return NextResponse.json(updated)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const isOwner = await checkPermission(session.user.id, 'owner', 'folder', id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Check folder is empty: no docs and no child folders
  const childDoc = db.select().from(documents).where(eq(documents.folderId, id)).get()
  const childFolder = db.select().from(folders).where(eq(folders.parentId, id)).get()

  if (childDoc || childFolder) {
    return NextResponse.json({ error: 'folder_not_empty' }, { status: 409 })
  }

  db.delete(folders).where(eq(folders.id, id)).run()

  // Clean up OpenFGA tuples
  const tuples = await readTuples(`folder:${id}`)
  for (const t of tuples) {
    await deleteTuple(t.user, t.relation, `folder:${id}`)
  }

  return NextResponse.json({ ok: true })
}
