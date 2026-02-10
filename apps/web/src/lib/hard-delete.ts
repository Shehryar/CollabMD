import { db, documents, shareLinks, documentSnapshots, eq } from '@collabmd/db'
import { readTuples, deleteTuple } from '@collabmd/shared'

export async function hardDeleteDocument(docId: string) {
  // 1. Delete share links
  db.delete(shareLinks).where(eq(shareLinks.documentId, docId)).run()

  // 2. Delete snapshots
  db.delete(documentSnapshots).where(eq(documentSnapshots.documentId, docId)).run()

  // 3. Clean up FGA tuples
  const tuples = await readTuples(`document:${docId}`)
  for (const t of tuples) {
    await deleteTuple(t.user, t.relation, `document:${docId}`)
  }

  // 4. Delete document
  db.delete(documents).where(eq(documents.id, docId)).run()
}
