import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, eq } from '@collabmd/db'

export async function POST(
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

  if (!doc.deletedAt) {
    return NextResponse.json({ error: 'Document is not deleted' }, { status: 400 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  if (doc.deletedAt < thirtyDaysAgo) {
    return NextResponse.json({ error: 'Document expired, cannot restore' }, { status: 410 })
  }

  const restored = db
    .update(documents)
    .set({ deletedAt: null })
    .where(eq(documents.id, id))
    .returning()
    .get()

  return NextResponse.json(restored)
}
