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

  const preferencesTable = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_notification_preferences'",
    )
    .get() as { name?: string } | undefined
  if (!preferencesTable) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email_notifications TEXT NOT NULL DEFAULT 'all',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS user_notification_preferences_email_notifications_idx
        ON user_notification_preferences (email_notifications);
    `)
  }

  const webhooksTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'webhooks'")
    .get() as { name?: string } | undefined
  if (!webhooksTable) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY NOT NULL,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT true
      );
    `)
  }
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS webhooks_org_id_idx ON webhooks (org_id);
    CREATE INDEX IF NOT EXISTS webhooks_created_by_idx ON webhooks (created_by);
    CREATE INDEX IF NOT EXISTS webhooks_active_idx ON webhooks (active);
  `)

  const webhookDeliveriesTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'webhook_deliveries'")
    .get() as { name?: string } | undefined
  if (!webhookDeliveriesTable) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY NOT NULL,
        webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status_code INTEGER,
        response_body TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        last_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  }
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_id_idx
      ON webhook_deliveries (webhook_id);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_event_type_idx
      ON webhook_deliveries (event_type);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_created_at_idx
      ON webhook_deliveries (created_at);
  `)

  const agentKeysTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_keys'")
    .get() as { name?: string } | undefined
  if (!agentKeysTable) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS agent_keys (
        id TEXT PRIMARY KEY NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        scopes TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
    `)
  }
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS agent_keys_org_id_idx ON agent_keys (org_id);
    CREATE INDEX IF NOT EXISTS agent_keys_created_by_idx ON agent_keys (created_by);
    CREATE INDEX IF NOT EXISTS agent_keys_revoked_at_idx ON agent_keys (revoked_at);
  `)
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
