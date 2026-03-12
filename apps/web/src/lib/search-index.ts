// Re-export search functions from @collabmd/db for backwards compatibility.
// The db package now handles both SQLite FTS5 and Postgres tsvector.
export {
  indexDocument,
  removeFromSearchIndex,
  searchDocuments,
  indexDocumentFromSnapshot,
} from '@collabmd/db'
