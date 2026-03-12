import { createRequire } from 'node:module'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as sqliteSchema from './schema.js'

const require = createRequire(import.meta.url)

export const isPostgres = (process.env.DATABASE_URL ?? '').startsWith('postgres')

// Use the SQLite Drizzle type as the canonical compile-time type.
// At runtime in Postgres mode, the actual instance is a PostgresJsDatabase,
// but the query API is structurally compatible at the JavaScript level.
type DbInstance = BetterSQLite3Database<typeof sqliteSchema>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRawClient = any

let dbInstance: DbInstance | null = null
let rawClient: AnyRawClient | null = null

// ─── SQLite compatibility backfill (only runs for SQLite) ───

function ensureSchemaCompatibility(sqlite: AnyRawClient): void {
  const documentsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'")
    .get() as { name?: string } | undefined
  if (!documentsTable) return

  const columns = sqlite.prepare('PRAGMA table_info(documents)').all() as Array<{ name?: string }>
  const hasSource = columns.some((column: { name?: string }) => column.name === 'source')
  if (!hasSource) {
    sqlite.exec("ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'web'")
    sqlite.exec("UPDATE documents SET source = 'web' WHERE source IS NULL")
  }

  const hasDocPosition = columns.some((column: { name?: string }) => column.name === 'position')
  if (!hasDocPosition) {
    sqlite.exec('ALTER TABLE documents ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
  }

  const foldersTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'folders'")
    .get() as { name?: string } | undefined
  if (foldersTable) {
    const folderCols = sqlite.prepare('PRAGMA table_info(folders)').all() as Array<{
      name?: string
    }>
    const hasFolderPosition = folderCols.some(
      (column: { name?: string }) => column.name === 'position',
    )
    if (!hasFolderPosition) {
      sqlite.exec('ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
    }
  }

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

// ─── Database initialization ───

function initSqlite(): { db: DbInstance; raw: AnyRawClient } {
  // Use createRequire to conditionally load better-sqlite3 (native module)
  const Database = require('better-sqlite3')
  const { drizzle } = require('drizzle-orm/better-sqlite3')

  const configuredUrl = process.env.DATABASE_URL ?? 'local.db'
  const sqlitePath = configuredUrl.startsWith('file:')
    ? configuredUrl.slice('file:'.length)
    : configuredUrl
  const sqlite = new Database(sqlitePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  ensureSchemaCompatibility(sqlite)

  return { db: drizzle(sqlite, { schema: sqliteSchema }), raw: sqlite }
}

function initPostgres(): { db: DbInstance; raw: AnyRawClient } {
  // Use createRequire to load postgres (the postgres.js driver)
  const pg = require('postgres')
  const { drizzle } = require('drizzle-orm/postgres-js')
  const pgSchema = require('./schema-pg.js')

  const sql = pg(process.env.DATABASE_URL!, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return { db: drizzle(sql, { schema: pgSchema }), raw: sql }
}

export function getDb(): DbInstance {
  if (dbInstance) return dbInstance

  const result = isPostgres ? initPostgres() : initSqlite()
  dbInstance = result.db
  rawClient = result.raw
  return dbInstance
}

export const db: DbInstance = new Proxy(
  {} as DbInstance,
  {
    get(_target, prop, receiver) {
      const instance = getDb()
      const value = Reflect.get(instance, prop, receiver)
      return typeof value === 'function' ? value.bind(instance) : value
    },
  },
)

/**
 * Get the underlying better-sqlite3 Database instance.
 * Only available in SQLite mode. Throws in Postgres mode.
 */
export function getSqlite(): AnyRawClient {
  getDb() // ensure initialized
  if (isPostgres) {
    throw new Error('getSqlite() is not available in Postgres mode. Use getPgClient() instead.')
  }
  return rawClient
}

/**
 * Get the underlying postgres.js SQL client.
 * Only available in Postgres mode. Throws in SQLite mode.
 */
export function getPgClient(): AnyRawClient {
  getDb() // ensure initialized
  if (!isPostgres) {
    throw new Error('getPgClient() is not available in SQLite mode. Use getSqlite() instead.')
  }
  return rawClient
}

/**
 * Get the raw database client (better-sqlite3 or postgres.js).
 * Use isPostgres to determine which type.
 */
export function getRawClient(): AnyRawClient {
  getDb() // ensure initialized
  return rawClient
}
