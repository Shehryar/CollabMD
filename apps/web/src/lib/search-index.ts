import { getSqlite } from '@collabmd/db'

/**
 * Upsert a document into the FTS5 search index.
 * Replaces any existing entry for the given document ID.
 */
export function indexDocument(documentId: string, title: string, content: string): void {
  const sqlite = getSqlite()
  sqlite.prepare('DELETE FROM document_search WHERE document_id = ?').run(documentId)
  sqlite
    .prepare('INSERT INTO document_search (document_id, title, content) VALUES (?, ?, ?)')
    .run(documentId, title, content)
}

/**
 * Remove a document from the FTS5 search index.
 */
export function removeFromSearchIndex(documentId: string): void {
  const sqlite = getSqlite()
  sqlite.prepare('DELETE FROM document_search WHERE document_id = ?').run(documentId)
}

/**
 * Search the FTS5 index and return matching document IDs with highlighted snippets.
 * Results are limited to the provided set of accessible document IDs.
 */
export function searchDocuments(
  query: string,
  accessibleDocIds: string[],
): Array<{ documentId: string; snippet: string }> {
  if (!query.trim() || accessibleDocIds.length === 0) return []

  const sanitized = sanitizeFtsQuery(query)
  if (!sanitized) return []

  const sqlite = getSqlite()

  const placeholders = accessibleDocIds.map(() => '?').join(',')

  const stmt = sqlite.prepare(`
    SELECT
      document_id,
      snippet(document_search, 1, '<mark>', '</mark>', '...', 32) as title_snippet,
      snippet(document_search, 2, '<mark>', '</mark>', '...', 32) as content_snippet
    FROM document_search
    WHERE document_search MATCH ?
      AND document_id IN (${placeholders})
    ORDER BY rank
    LIMIT 50
  `)

  const rows = stmt.all(sanitized, ...accessibleDocIds) as Array<{
    document_id: string
    title_snippet: string
    content_snippet: string
  }>

  return rows.map((row) => ({
    documentId: row.document_id,
    snippet: row.content_snippet || row.title_snippet,
  }))
}

/**
 * Index a document using its Y.Doc snapshot buffer.
 * Extracts plain text from the codemirror Y.Text type.
 */
export function indexDocumentFromSnapshot(
  documentId: string,
  title: string,
  snapshotBuffer: Buffer | Uint8Array | null,
): void {
  let content = ''
  if (snapshotBuffer && snapshotBuffer.byteLength > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Y = require('yjs') as typeof import('yjs')
      const ydoc = new Y.Doc()
      Y.applyUpdate(ydoc, new Uint8Array(snapshotBuffer))
      content = ydoc.getText('codemirror').toString()
      ydoc.destroy()
    } catch {
      // If yjs is not available or snapshot is corrupted, index title only
    }
  }

  indexDocument(documentId, title, content)
}

/**
 * Sanitize user input for FTS5 MATCH query.
 * Wraps each word in double-quotes to prevent syntax errors from special characters.
 * The last token uses prefix matching for incremental search.
 */
function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/['"]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)

  if (tokens.length === 0) return ''

  const parts = tokens.map((t, i) => {
    const escaped = t.replace(/"/g, '""')
    if (i === tokens.length - 1) {
      return `"${escaped}"*`
    }
    return `"${escaped}"`
  })

  return parts.join(' ')
}
