import { isPostgres, getSqlite, getPgClient } from './client.js'

/**
 * Upsert a document into the full-text search index.
 * Uses FTS5 for SQLite, plain table + tsvector for Postgres.
 */
export async function indexDocument(
  documentId: string,
  title: string,
  content: string,
): Promise<void> {
  if (isPostgres) {
    const sql = getPgClient()
    await sql`
      INSERT INTO document_search (document_id, title, content)
      VALUES (${documentId}, ${title}, ${content})
      ON CONFLICT (document_id) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content
    `
  } else {
    const sqlite = getSqlite()
    sqlite.prepare('DELETE FROM document_search WHERE document_id = ?').run(documentId)
    sqlite
      .prepare('INSERT INTO document_search (document_id, title, content) VALUES (?, ?, ?)')
      .run(documentId, title, content)
  }
}

/**
 * Remove a document from the search index.
 */
export async function removeFromSearchIndex(documentId: string): Promise<void> {
  if (isPostgres) {
    const sql = getPgClient()
    await sql`DELETE FROM document_search WHERE document_id = ${documentId}`
  } else {
    const sqlite = getSqlite()
    sqlite.prepare('DELETE FROM document_search WHERE document_id = ?').run(documentId)
  }
}

/**
 * Search the index and return matching document IDs with highlighted snippets.
 * Results are limited to the provided set of accessible document IDs.
 */
export async function searchDocuments(
  query: string,
  accessibleDocIds: string[],
): Promise<Array<{ documentId: string; snippet: string }>> {
  if (!query.trim() || accessibleDocIds.length === 0) return []

  if (isPostgres) {
    return searchPostgres(query, accessibleDocIds)
  } else {
    return searchSqlite(query, accessibleDocIds)
  }
}

// ─── Postgres full-text search ───

async function searchPostgres(
  query: string,
  accessibleDocIds: string[],
): Promise<Array<{ documentId: string; snippet: string }>> {
  const sql = getPgClient()

  // Use plainto_tsquery for safe input handling (no special syntax needed)
  const rows = await sql`
    SELECT
      document_id,
      ts_headline('english', content, plainto_tsquery('english', ${query}),
        'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=32') as snippet
    FROM document_search
    WHERE (
      to_tsvector('english', title) || to_tsvector('english', content)
    ) @@ plainto_tsquery('english', ${query})
      AND document_id = ANY(${accessibleDocIds})
    ORDER BY ts_rank(
      to_tsvector('english', title) || to_tsvector('english', content),
      plainto_tsquery('english', ${query})
    ) DESC
    LIMIT 50
  `

  return rows.map((row: { document_id: string; snippet: string }) => ({
    documentId: row.document_id,
    snippet: row.snippet,
  }))
}

// ─── SQLite FTS5 search ───

function searchSqlite(
  query: string,
  accessibleDocIds: string[],
): Array<{ documentId: string; snippet: string }> {
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

/**
 * Index a document using its Y.Doc snapshot buffer.
 * Extracts plain text from the codemirror Y.Text type.
 */
export async function indexDocumentFromSnapshot(
  documentId: string,
  title: string,
  snapshotBuffer: Buffer | Uint8Array | null,
): Promise<void> {
  let content = ''
  if (snapshotBuffer && snapshotBuffer.byteLength > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const Y = require('yjs')
      const ydoc = new Y.Doc()
      Y.applyUpdate(ydoc, new Uint8Array(snapshotBuffer))
      content = ydoc.getText('codemirror').toString()
      ydoc.destroy()
    } catch {
      // If yjs is not available or snapshot is corrupted, index title only
    }
  }

  await indexDocument(documentId, title, content)
}

/**
 * Ensure the Postgres search infrastructure exists.
 * Creates the document_search table and GIN index if missing.
 * Call this once at startup in Postgres mode.
 */
export async function ensureSearchSchema(): Promise<void> {
  if (!isPostgres) return

  const sql = getPgClient()
  await sql`
    CREATE TABLE IF NOT EXISTS document_search (
      document_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT ''
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS document_search_fts_idx
    ON document_search
    USING GIN (
      (to_tsvector('english', title) || to_tsvector('english', content))
    )
  `
}
