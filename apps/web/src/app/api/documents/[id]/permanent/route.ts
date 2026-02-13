import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, eq } from '@collabmd/db'
import { hardDeleteDocument } from '@/lib/hard-delete'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'

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
  const doc = db.select().from(documents).where(eq(documents.id, id)).get()

  if (!doc) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!doc.deletedAt) {
    return NextResponse.json({ error: 'document must be in trash before permanent deletion' }, { status: 409 })
  }

  await hardDeleteDocument(id)

  return NextResponse.json({ ok: true })
}
