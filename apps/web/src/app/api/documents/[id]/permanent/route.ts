import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, eq } from '@collabmd/db'
import { hardDeleteDocument } from '@/lib/hard-delete'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const doc = db.select().from(documents).where(eq(documents.id, id)).get()

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await hardDeleteDocument(id)

  return NextResponse.json({ ok: true })
}
