import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, eq, and, isNull } from '@collabmd/db'
import { checkPermission } from '@collabmd/shared'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const doc = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .get()

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(doc)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'document', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { title } = body as { title: string }

  const updated = db
    .update(documents)
    .set({ title, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning()
    .get()

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

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
  const isOwner = await checkPermission(session.user.id, 'owner', 'document', id)
  if (!isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  db.update(documents)
    .set({ deletedAt: new Date() })
    .where(eq(documents.id, id))
    .run()

  return NextResponse.json({ ok: true })
}
