import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db, documents, documentSnapshots, members, eq, desc, isNull } from '@collabmd/db'
import { getSqlite } from '@collabmd/db'
import { indexDocumentFromSnapshot } from '@/lib/search-index'

export async function POST(_request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Check that the user is an owner or admin of at least one org
  const userMemberships = db.select().from(members).where(eq(members.userId, session.user.id)).all()

  const isOrgOwnerOrAdmin = userMemberships.some((m) => m.role === 'owner' || m.role === 'admin')

  if (!isOrgOwnerOrAdmin) {
    return NextResponse.json({ error: 'forbidden: org owner or admin required' }, { status: 403 })
  }

  // Clear existing FTS index
  const sqlite = getSqlite()
  sqlite.exec('DELETE FROM document_search')

  // Get all non-deleted documents
  const allDocs = db
    .select({
      id: documents.id,
      title: documents.title,
    })
    .from(documents)
    .where(isNull(documents.deletedAt))
    .all()

  let indexed = 0

  for (const doc of allDocs) {
    // Get the latest snapshot for this document
    const snapshot = db
      .select({ snapshot: documentSnapshots.snapshot })
      .from(documentSnapshots)
      .where(eq(documentSnapshots.documentId, doc.id))
      .orderBy(desc(documentSnapshots.createdAt))
      .get()

    try {
      indexDocumentFromSnapshot(doc.id, doc.title, snapshot?.snapshot ?? null)
      indexed++
    } catch {
      // Skip documents that fail to index
    }
  }

  return NextResponse.json({ ok: true, indexed, total: allDocs.length })
}
