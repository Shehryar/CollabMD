import { sqliteTable, text, integer, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ─── Better Auth managed tables ───

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  activeOrganizationId: text('active_organization_id')
    .references(() => organizations.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdIdx: index('sessions_user_id_idx').on(table.userId),
  activeOrganizationIdIdx: index('sessions_active_org_id_idx').on(table.activeOrganizationId),
}))

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdIdx: index('accounts_user_id_idx').on(table.userId),
}))

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

// ─── Better Auth org plugin tables ───

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  organizationIdIdx: index('members_org_id_idx').on(table.organizationId),
  userIdIdx: index('members_user_id_idx').on(table.userId),
  orgUserUnique: uniqueIndex('members_org_user_unique').on(table.organizationId, table.userId),
}))

export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
  status: text('status').notNull().default('pending'),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  organizationIdIdx: index('invitations_org_id_idx').on(table.organizationId),
  inviterIdIdx: index('invitations_inviter_id_idx').on(table.inviterId),
}))

// ─── Better Auth JWT plugin table ───

export const jwks = sqliteTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ─── CollabMD application tables ───

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  parentId: text('parent_id').references((): ReturnType<typeof text> => folders.id, {
    onDelete: 'cascade',
  }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  orgIdIdx: index('folders_org_id_idx').on(table.orgId),
  parentIdIdx: index('folders_parent_id_idx').on(table.parentId),
  createdByIdx: index('folders_created_by_idx').on(table.createdBy),
}))

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  source: text('source').default('web'),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  agentEditable: integer('agent_editable', { mode: 'boolean' }).notNull().default(true),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  orgIdIdx: index('documents_org_id_idx').on(table.orgId),
  ownerIdIdx: index('documents_owner_id_idx').on(table.ownerId),
  folderIdIdx: index('documents_folder_id_idx').on(table.folderId),
  deletedAtIdx: index('documents_deleted_at_idx').on(table.deletedAt),
}))

export const documentSnapshots = sqliteTable('document_snapshots', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  snapshot: blob('snapshot', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  createdBy: text('created_by').references(() => users.id),
  isAgentEdit: integer('is_agent_edit', { mode: 'boolean' }).notNull().default(false),
  label: text('label'),
}, (table) => ({
  documentIdIdx: index('document_snapshots_document_id_idx').on(table.documentId),
  createdByIdx: index('document_snapshots_created_by_idx').on(table.createdBy),
}))

export const shareLinks = sqliteTable('share_links', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  permission: text('permission').notNull().default('viewer'),
  passwordHash: text('password_hash'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  documentIdIdx: index('share_links_document_id_idx').on(table.documentId),
  createdByIdx: index('share_links_created_by_idx').on(table.createdBy),
}))
