// Re-export schema tables from the active dialect.
// At compile time, TypeScript sees the SQLite types (used during development).
// At runtime, isPostgres switches to Postgres schema when DATABASE_URL is set.
import * as sqliteSchema from './schema.js'
import * as pgSchema from './schema-pg.js'
import { isPostgres } from './client.js'

const _s = isPostgres ? pgSchema : sqliteSchema

// Table exports — typed as SQLite schema for development DX,
// but may be Postgres tables at runtime in production.
type S = typeof sqliteSchema
export const users = _s.users as S['users']
export const sessions = _s.sessions as S['sessions']
export const accounts = _s.accounts as S['accounts']
export const verifications = _s.verifications as S['verifications']
export const organizations = _s.organizations as S['organizations']
export const members = _s.members as S['members']
export const invitations = _s.invitations as S['invitations']
export const jwks = _s.jwks as S['jwks']
export const folders = _s.folders as S['folders']
export const documents = _s.documents as S['documents']
export const documentSnapshots = _s.documentSnapshots as S['documentSnapshots']
export const shareLinks = _s.shareLinks as S['shareLinks']
export const webhooks = _s.webhooks as S['webhooks']
export const webhookDeliveries = _s.webhookDeliveries as S['webhookDeliveries']
export const agentKeys = _s.agentKeys as S['agentKeys']
export const userNotificationPreferences =
  _s.userNotificationPreferences as S['userNotificationPreferences']
export const notifications = _s.notifications as S['notifications']

// Notification preferences helpers
export * from './notification-preferences.js'

// Client exports
export { db, getDb, getSqlite, getPgClient, getRawClient, isPostgres } from './client.js'

// Search index exports
export {
  indexDocument,
  removeFromSearchIndex,
  searchDocuments,
  indexDocumentFromSnapshot,
  ensureSearchSchema,
} from './search.js'

// Drizzle operators (re-exported to avoid dual-instance issues with pnpm)
export {
  eq,
  and,
  or,
  not,
  isNull,
  isNotNull,
  inArray,
  desc,
  asc,
  sql,
  like,
  ne,
  count,
} from 'drizzle-orm'
