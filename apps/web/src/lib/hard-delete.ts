import { db, documents, shareLinks, documentSnapshots, eq } from '@collabmd/db'
import { readTuplesForEntity, deleteTuple } from '@collabmd/shared'
import { removeFromSearchIndex } from '@/lib/search-index'

export async function hardDeleteDocument(docId: string) {
  const docObject = `document:${docId}`

  // 1. Clean up all OpenFGA tuples where the document appears as object or user.
  const tuples = await readTuplesForEntity(docObject)
  for (const t of tuples) {
    await deleteTuple(t.user, t.relation, t.object)
  }

  // 2. Remove from search index (best-effort, before deleting rows).
  try {
    removeFromSearchIndex(docId)
  } catch {
    // Non-critical: stale FTS entries are harmless (filtered by permission)
  }

  // 3. Delete DB rows in a single transaction.
  db.transaction((tx) => {
    tx.delete(shareLinks).where(eq(shareLinks.documentId, docId)).run()
    tx.delete(documentSnapshots).where(eq(documentSnapshots.documentId, docId)).run()
    tx.delete(documents).where(eq(documents.id, docId)).run()
  })
}
