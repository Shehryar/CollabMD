import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { checkPermission } from '@collabmd/shared'
import * as Y from 'yjs'
import { and, db, documentSnapshots, eq, users } from '@collabmd/db'

type RouteParams = { params: Promise<{ id: string; snapshotId: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id: docId, snapshotId } = await params
  const canView = await checkPermission(session.user.id, 'can_view', 'document', docId)
  if (!canView) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const snapshot = db
    .select({
      id: documentSnapshots.id,
      snapshot: documentSnapshots.snapshot,
      createdAt: documentSnapshots.createdAt,
      createdBy: documentSnapshots.createdBy,
      createdByName: users.name,
      isAgentEdit: documentSnapshots.isAgentEdit,
      label: documentSnapshots.label,
    })
    .from(documentSnapshots)
    .leftJoin(users, eq(documentSnapshots.createdBy, users.id))
    .where(and(eq(documentSnapshots.id, snapshotId), eq(documentSnapshots.documentId, docId)))
    .get()

  if (!snapshot) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const tempDoc = new Y.Doc()
  Y.applyUpdate(tempDoc, new Uint8Array(snapshot.snapshot))
  const content = tempDoc.getText('codemirror').toString()
  tempDoc.destroy()

  return NextResponse.json({
    id: snapshot.id,
    createdAt: snapshot.createdAt.toISOString(),
    createdBy: snapshot.createdBy,
    createdByName: snapshot.createdByName,
    isAgentEdit: snapshot.isAgentEdit,
    label: snapshot.label,
    content,
  })
}
