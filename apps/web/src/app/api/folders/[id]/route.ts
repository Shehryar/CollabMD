import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, folders, documents, eq, and, like } from '@collabmd/db'
import { checkPermission, readTuplesForEntity, deleteTuple } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const { name, parentId, position } = body as {
    name?: string
    parentId?: string | null
    position?: number
  }

  if (!name && parentId === undefined && position === undefined) {
    return NextResponse.json({ error: 'name, parentId, or position is required' }, { status: 400 })
  }

  const existing = db.select().from(folders).where(eq(folders.id, id)).get()
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}

  // Handle parentId change (move folder to a new parent)
  if (parentId !== undefined && parentId !== existing.parentId) {
    // Circular reference check: target parentId must not be the folder itself or a descendant
    if (parentId === id) {
      return NextResponse.json({ error: 'cannot move folder into itself' }, { status: 400 })
    }
    if (parentId !== null) {
      const target = db.select().from(folders).where(eq(folders.id, parentId)).get()
      if (!target) {
        return NextResponse.json({ error: 'target parent folder not found' }, { status: 404 })
      }
      if (target.orgId !== existing.orgId) {
        return NextResponse.json(
          { error: 'target folder belongs to a different organization' },
          { status: 400 },
        )
      }
      // Walk up from target to root. If we hit `id`, it's circular.
      let cursor: string | null = parentId
      while (cursor) {
        if (cursor === id) {
          return NextResponse.json(
            { error: 'circular reference: cannot move folder into its own descendant' },
            { status: 400 },
          )
        }
        const ancestor = db.select().from(folders).where(eq(folders.id, cursor)).get()
        cursor = ancestor?.parentId ?? null
      }
    }
    updates.parentId = parentId
  }

  // Handle position change
  if (position !== undefined) {
    updates.position = position
  }

  // Recalculate path
  const effectiveName = name ?? existing.name
  const effectiveParentId = (
    updates.parentId !== undefined ? updates.parentId : existing.parentId
  ) as string | null
  let newPath: string
  if (effectiveParentId) {
    const parent = db.select().from(folders).where(eq(folders.id, effectiveParentId)).get()
    newPath = parent ? `${parent.path}/${effectiveName}` : `/${effectiveName}`
  } else {
    newPath = `/${effectiveName}`
  }

  if (name) updates.name = name
  updates.path = newPath

  const updated = db.update(folders).set(updates).where(eq(folders.id, id)).returning().get()

  // Keep descendant paths in sync when path changes.
  if (newPath !== existing.path) {
    const descendants = db
      .select()
      .from(folders)
      .where(and(eq(folders.orgId, existing.orgId), like(folders.path, `${existing.path}/%`)))
      .all()

    for (const child of descendants) {
      const nextPath = child.path.replace(existing.path, newPath)
      db.update(folders).set({ path: nextPath }).where(eq(folders.id, child.id)).run()
    }
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
