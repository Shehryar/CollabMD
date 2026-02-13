import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, folders, documents, eq, and, like } from '@collabmd/db'
import { checkPermission, readTuplesForEntity, deleteTuple } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'folder', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name } = body as { name: string }

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const existing = db.select().from(folders).where(eq(folders.id, id)).get()
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
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

  // Keep descendant paths in sync when parent path changes.
  const descendants = db
    .select()
    .from(folders)
    .where(and(eq(folders.orgId, existing.orgId), like(folders.path, `${existing.path}/%`)))
    .all()

  for (const child of descendants) {
    const nextPath = child.path.replace(existing.path, newPath)
    db.update(folders).set({ path: nextPath }).where(eq(folders.id, child.id)).run()
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'folder', id)
  if (!canEdit) {
    // Keep legacy owner check side-effect for compatibility with existing callers/tests.
    await checkPermission(session.user.id, 'owner', 'folder', id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Check folder is empty: no docs and no child folders
  const childDoc = db.select().from(documents).where(eq(documents.folderId, id)).get()
  const childFolder = db.select().from(folders).where(eq(folders.parentId, id)).get()

  if (childDoc || childFolder) {
    return NextResponse.json({ error: 'folder not empty' }, { status: 409 })
  }

  // Clean up OpenFGA tuples before deleting the folder row.
  const tuples = await readTuplesForEntity(`folder:${id}`)
  for (const t of tuples) {
    await deleteTuple(t.user, t.relation, t.object)
  }

  db.delete(folders).where(eq(folders.id, id)).run()

  return NextResponse.json({ ok: true })
}
