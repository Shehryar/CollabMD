import Database from 'better-sqlite3'
import path from 'path'
import crypto from 'crypto'

const testDbPath = path.join(__dirname, '..', '..', 'apps', 'web', 'test.db')

let cachedDb: Database.Database | null = null

export function getTestDb(): Database.Database {
  if (cachedDb) return cachedDb
  cachedDb = new Database(testDbPath)
  cachedDb.pragma('journal_mode = WAL')
  cachedDb.pragma('foreign_keys = ON')
  return cachedDb
}

export function createTestUser(opts?: { name?: string; email?: string }): {
  id: string
  name: string
  email: string
} {
  const db = getTestDb()
  const id = crypto.randomUUID()
  const name = opts?.name ?? `Test User ${id.slice(0, 6)}`
  const email = opts?.email ?? `test-${id.slice(0, 8)}@e2e.local`
  const now = Math.floor(Date.now() / 1000)

  db.prepare(
    `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(id, name, email, now, now)

  return { id, name, email }
}

export function createTestOrg(
  userId: string,
  opts?: { name?: string; slug?: string },
): { id: string; name: string; slug: string } {
  const db = getTestDb()
  const id = crypto.randomUUID()
  const name = opts?.name ?? `Test Org ${id.slice(0, 6)}`
  const slug = opts?.slug ?? `test-org-${id.slice(0, 8)}`
  const now = Math.floor(Date.now() / 1000)

  db.prepare(
    `INSERT INTO organizations (id, name, slug, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, name, slug, now)

  // Add owner membership
  const memberId = crypto.randomUUID()
  db.prepare(
    `INSERT INTO members (id, organization_id, user_id, role, created_at)
     VALUES (?, ?, ?, 'owner', ?)`,
  ).run(memberId, id, userId, now)

  return { id, name, slug }
}

export function createTestSession(
  userId: string,
  orgId: string,
): { id: string; token: string } {
  const db = getTestDb()
  const id = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 24 * 60 * 60 // 24 hours

  db.prepare(
    `INSERT INTO sessions (id, user_id, token, expires_at, active_organization_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, token, expiresAt, orgId, now, now)

  return { id, token }
}

export function createTestDocument(opts: {
  orgId: string
  ownerId: string
  title?: string
  folderId?: string | null
}): { id: string; title: string } {
  const db = getTestDb()
  const id = crypto.randomUUID()
  const title = opts.title ?? `Test Doc ${id.slice(0, 6)}`
  const now = Math.floor(Date.now() / 1000)

  db.prepare(
    `INSERT INTO documents (id, title, source, org_id, owner_id, folder_id, is_public, agent_editable, created_at, updated_at)
     VALUES (?, ?, 'web', ?, ?, ?, 0, 1, ?, ?)`,
  ).run(id, title, opts.orgId, opts.ownerId, opts.folderId ?? null, now, now)

  return { id, title }
}

export function addOrgMember(
  orgId: string,
  userId: string,
  role = 'member',
): void {
  const db = getTestDb()
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(
    `INSERT OR IGNORE INTO members (id, organization_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, orgId, userId, role, now)
}

export function cleanupTestData(): void {
  const db = getTestDb()
  const tables = [
    'webhook_deliveries',
    'webhooks',
    'agent_keys',
    'share_links',
    'document_snapshots',
    'documents',
    'invitations',
    'members',
    'organizations',
    'sessions',
    'accounts',
    'verifications',
    'jwks',
    'users',
  ]
  for (const table of tables) {
    db.prepare(`DELETE FROM ${table}`).run()
  }
}
