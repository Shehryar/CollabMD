import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

type DbInstance = ReturnType<typeof drizzle<typeof schema>>

let dbInstance: DbInstance | null = null

function ensureSchemaCompatibility(sqlite: Database.Database): void {
  // Backfill legacy dev DBs created before documents.source existed.
  // These DBs don't have drizzle migration metadata, so a full migrate can fail.
  const documentsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'")
    .get() as { name?: string } | undefined
  if (!documentsTable) return

  const columns = sqlite.prepare('PRAGMA table_info(documents)').all() as Array<{ name?: string }>
  const hasSource = columns.some((column) => column.name === 'source')
  if (!hasSource) {
    sqlite.exec("ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'web'")
    sqlite.exec("UPDATE documents SET source = 'web' WHERE source IS NULL")
  }

  const hasDocPosition = columns.some((column) => column.name === 'position')
  if (!hasDocPosition) {
    sqlite.exec('ALTER TABLE documents ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
  }

  // Backfill folders.position for legacy DBs.
  const foldersTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'folders'")
    .get() as { name?: string } | undefined
  if (foldersTable) {
    const folderCols = sqlite.prepare('PRAGMA table_info(folders)').all() as Array<{
      name?: string
    }>
    const hasFolderPosition = folderCols.some((column) => column.name === 'position')
    if (!hasFolderPosition) {
      sqlite.exec('ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
    }
  }

  // Ensure FTS5 virtual table for full-text search exists.
  const ftsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'document_search'")
    .get() as { name?: string } | undefined
  if (!ftsTable) {
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
        document_id UNINDEXED,
        title,
        content
      )
    `)
  }
}

export function getDb(): DbInstance {
  if (dbInstance) return dbInstance

  const configuredUrl = process.env.DATABASE_URL ?? 'local.db'
  const sqlitePath = configuredUrl.startsWith('file:')
    ? configuredUrl.slice('file:'.length)
    : configuredUrl
  const sqlite = new Database(sqlitePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  ensureSchemaCompatibility(sqlite)

  dbInstance = drizzle(sqlite, { schema })
  return dbInstance
}

export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    const instance = getDb()
    const value = Reflect.get(instance, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

/**
 * Get the underlying better-sqlite3 Database instance.
 * Useful for raw SQL queries (e.g., FTS5 virtual tables).
 */
export function getSqlite(): Database.Database {
  const drizzleDb = getDb()
  return (drizzleDb as unknown as { session: { client: Database.Database } }).session.client
}
