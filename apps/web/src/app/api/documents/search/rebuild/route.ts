import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import {
  db,
  documents,
  documentSnapshots,
  members,
  eq,
  desc,
  isNull,
  isPostgres,
  getSqlite,
  getPgClient,
} from '@collabmd/db'
import { indexDocumentFromSnapshot } from '@/lib/search-index'

export async function POST(_request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Check that the user is an owner or admin of at least one org
  const userMemberships = await db
    .select()
    .from(members)
    .where(eq(members.userId, session.user.id))

  const isOrgOwnerOrAdmin = userMemberships.some(
    (m: { role: string }) => m.role === 'owner' || m.role === 'admin',
  )

  if (!isOrgOwnerOrAdmin) {
    return NextResponse.json({ error: 'forbidden: org owner or admin required' }, { status: 403 })
  }

  // Clear existing search index
  if (isPostgres) {
    const sql = getPgClient()
    await sql`DELETE FROM document_search`
  } else {
    const sqlite = getSqlite()
    sqlite.exec('DELETE FROM document_search')
  }

  // Get all non-deleted documents
  const allDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
    })
    .from(documents)
    .where(isNull(documents.deletedAt))

  let indexed = 0

  for (const doc of allDocs) {
    // Get the latest snapshot for this document
    const snapshots = await db
      .select({ snapshot: documentSnapshots.snapshot })
      .from(documentSnapshots)
      .where(eq(documentSnapshots.documentId, doc.id))
      .orderBy(desc(documentSnapshots.createdAt))
      .limit(1)

    try {
      await indexDocumentFromSnapshot(doc.id, doc.title, snapshots[0]?.snapshot ?? null)
      indexed++
    } catch {
      // Skip documents that fail to index
    }
  }

  return NextResponse.json({ ok: true, indexed, total: allDocs.length })
}
