import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core'

// Custom bytea type for binary data (Yjs snapshots)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

// ─── Better Auth managed tables ───

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: text('active_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
    activeOrganizationIdIdx: index('sessions_active_org_id_idx').on(table.activeOrganizationId),
  }),
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    userIdIdx: index('accounts_user_id_idx').on(table.userId),
  }),
)

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

// ─── Better Auth org plugin tables ───

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').notNull(),
})

export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => ({
    organizationIdIdx: index('members_org_id_idx').on(table.organizationId),
    userIdIdx: index('members_user_id_idx').on(table.userId),
    orgUserUnique: uniqueIndex('members_org_user_unique').on(table.organizationId, table.userId),
  }),
)

export const invitations = pgTable(
  'invitations',
  {
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
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => ({
    organizationIdIdx: index('invitations_org_id_idx').on(table.organizationId),
    inviterIdIdx: index('invitations_inviter_id_idx').on(table.inviterId),
  }),
)

// ─── Better Auth JWT plugin table ───

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull(),
})

// ─── CollabMD application tables ───

export const folders = pgTable(
  'folders',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    parentId: text('parent_id'),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => ({
    orgIdIdx: index('folders_org_id_idx').on(table.orgId),
    parentIdIdx: index('folders_parent_id_idx').on(table.parentId),
    createdByIdx: index('folders_created_by_idx').on(table.createdBy),
  }),
)

export const documents = pgTable(
  'documents',
  {
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
    isPublic: boolean('is_public').notNull().default(false),
    position: integer('position').notNull().default(0),
    agentEditable: boolean('agent_editable').notNull().default(true),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    orgIdIdx: index('documents_org_id_idx').on(table.orgId),
    ownerIdIdx: index('documents_owner_id_idx').on(table.ownerId),
    folderIdIdx: index('documents_folder_id_idx').on(table.folderId),
    deletedAtIdx: index('documents_deleted_at_idx').on(table.deletedAt),
    orgDeletedUpdatedIdx: index('documents_org_deleted_updated_idx').on(
      table.orgId,
      table.deletedAt,
      table.updatedAt,
    ),
  }),
)

export const documentSnapshots = pgTable(
  'document_snapshots',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    snapshot: bytea('snapshot').notNull(),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
    isAgentEdit: boolean('is_agent_edit').notNull().default(false),
    label: text('label'),
  },
  (table) => ({
    documentIdIdx: index('document_snapshots_document_id_idx').on(table.documentId),
    createdByIdx: index('document_snapshots_created_by_idx').on(table.createdBy),
  }),
)

export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    permission: text('permission').notNull().default('viewer'),
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => ({
    documentIdIdx: index('share_links_document_id_idx').on(table.documentId),
    createdByIdx: index('share_links_created_by_idx').on(table.createdBy),
  }),
)

export const webhooks = pgTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: text('events').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (table) => ({
    orgIdIdx: index('webhooks_org_id_idx').on(table.orgId),
    createdByIdx: index('webhooks_created_by_idx').on(table.createdBy),
    activeIdx: index('webhooks_active_idx').on(table.active),
  }),
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    statusCode: integer('status_code'),
    responseBody: text('response_body'),
    attemptCount: integer('attempt_count').notNull().default(1),
    lastAttemptAt: timestamp('last_attempt_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => ({
    webhookIdIdx: index('webhook_deliveries_webhook_id_idx').on(table.webhookId),
    eventTypeIdx: index('webhook_deliveries_event_type_idx').on(table.eventType),
    createdAtIdx: index('webhook_deliveries_created_at_idx').on(table.createdAt),
  }),
)

export const agentKeys = pgTable(
  'agent_keys',
  {
    id: text('id').primaryKey(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    scopes: text('scopes').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull(),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => ({
    orgIdIdx: index('agent_keys_org_id_idx').on(table.orgId),
    createdByIdx: index('agent_keys_created_by_idx').on(table.createdBy),
    revokedAtIdx: index('agent_keys_revoked_at_idx').on(table.revokedAt),
  }),
)

export const userNotificationPreferences = pgTable(
  'user_notification_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    emailNotifications: text('email_notifications').notNull().default('all'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    emailNotificationsIdx: index('user_notification_preferences_email_notifications_idx').on(
      table.emailNotifications,
    ),
  }),
)

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    resourceId: text('resource_id').notNull(),
    resourceType: text('resource_type').notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => ({
    userIdIdx: index('notifications_user_id_idx').on(table.userId),
    orgIdIdx: index('notifications_org_id_idx').on(table.orgId),
    readIdx: index('notifications_read_idx').on(table.read),
    createdAtIdx: index('notifications_created_at_idx').on(table.createdAt),
  }),
)

// ─── Postgres full-text search (replaces SQLite FTS5) ───

export const documentSearch = pgTable('document_search', {
  documentId: text('document_id').primaryKey(),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
})
