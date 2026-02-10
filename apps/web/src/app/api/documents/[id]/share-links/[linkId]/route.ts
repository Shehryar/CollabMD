import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db, shareLinks, eq, and } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { checkPermission } from '@collabmd/shared'

type RouteParams = { params: Promise<{ id: string; linkId: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id: docId, linkId } = await params
  const userId = session.user.id

  const canEdit = await checkPermission(userId, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  db.delete(shareLinks)
    .where(and(eq(shareLinks.id, linkId), eq(shareLinks.documentId, docId)))
    .run()

  return NextResponse.json({ ok: true })
}
