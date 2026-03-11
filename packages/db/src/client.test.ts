import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalDatabaseUrl = process.env.DATABASE_URL

afterEach(() => {
  process.env.DATABASE_URL = originalDatabaseUrl
  vi.resetModules()
})

describe('db client compatibility bootstrap', () => {
  it('creates webhook and agent key tables for legacy local databases', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collabmd-db-compat-'))
    const dbPath = path.join(tempDir, 'legacy.db')
    const sqlite = new Database(dbPath)

    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE documents (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        org_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        folder_id TEXT,
        is_public INTEGER NOT NULL DEFAULT false,
        agent_editable INTEGER NOT NULL DEFAULT true,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE folders (
        id TEXT PRIMARY KEY NOT NULL,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        parent_id TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
    sqlite.close()

    process.env.DATABASE_URL = dbPath
    const { getSqlite } = await import('./client.js')
    const compatibleSqlite = getSqlite()

    const tables = compatibleSqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
    const tableNames = new Set(tables.map((table) => table.name))

    expect(tableNames.has('webhooks')).toBe(true)
    expect(tableNames.has('webhook_deliveries')).toBe(true)
    expect(tableNames.has('agent_keys')).toBe(true)
  })
})
