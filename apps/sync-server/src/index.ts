import { createSyncServer } from './server.js'
import { verifyToken, verifySessionCookie } from './auth.js'
import type {
  NotificationRealtimeEvent,
  NotificationRecord,
  NotificationResourceType,
  NotificationType,
} from '@collabmd/shared'
import { checkPermission } from '@collabmd/shared'
import crypto from 'node:crypto'
import {
  db,
  documentSnapshots,
  documents,
  members,
  notifications,
  users,
  webhooks,
  webhookDeliveries,
  and,
  eq,
  inArray,
  sql,
  desc,
  getSqlite,
} from '@collabmd/db'
import * as Y from 'yjs'
import {
  createConcurrencyLimitedFetch,
  dispatchWebhookWithRetry,
  webhookSubscribedToEvent,
} from './webhook-dispatch.js'
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  isEncryptedWebhookSecret,
} from './webhook-secret.js'
import { sendMentionEmails } from './notification-email-service.js'

async function recordWebhookDelivery(input: {
  webhookId: string
  eventType: string
  payload: string
  statusCode: number | null
  responseBody: string
  attemptCount: number
}): Promise<void> {
  const now = new Date()
  db.insert(webhookDeliveries)
    .values({
      id: crypto.randomUUID(),
      webhookId: input.webhookId,
      eventType: input.eventType,
      payload: input.payload,
      statusCode: input.statusCode,
      responseBody: input.responseBody,
      attemptCount: input.attemptCount,
      lastAttemptAt: now,
      createdAt: now,
    })
    .run()
}

const PORT = parseInt(process.env.PORT ?? '4444', 10)
const SNAPSHOT_INTERVAL_MS = parseInt(process.env.SNAPSHOT_INTERVAL_MS ?? '300000', 10)
const WEBHOOK_MAX_CONCURRENCY = parseInt(process.env.WEBHOOK_MAX_CONCURRENCY ?? '20', 10)
const WEBHOOK_DELIVERY_RETENTION_DAYS = parseInt(
  process.env.WEBHOOK_DELIVERY_RETENTION_DAYS ?? '30',
  10,
)
const WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS = parseInt(
  process.env.WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS ?? `${60 * 60 * 1000}`,
  10,
)
const warnedInvalidWebhookEvents = new Set<string>()
const limitedWebhookFetch = createConcurrencyLimitedFetch(WEBHOOK_MAX_CONCURRENCY)

function truncateText(value: string, maxLength = 140): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`
}

function slugifyHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function extractMentionHandles(value: string): string[] {
  const handles = new Set<string>()
  for (const match of value.matchAll(/@([a-zA-Z0-9_-]+)/g)) {
    const handle = (match[1] ?? '').trim().toLowerCase()
    if (handle) handles.add(handle)
  }
  return Array.from(handles)
}

function createNotificationRow(input: {
  userId: string
  orgId: string
  type: NotificationType
  title: string
  body: string
  resourceId: string
  resourceType: NotificationResourceType
}): NotificationRecord {
  const id = crypto.randomUUID()
  const createdAt = new Date()
  db.insert(notifications)
    .values({
      id,
      userId: input.userId,
      orgId: input.orgId,
      type: input.type,
      title: input.title,
      body: input.body,
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      read: false,
      createdAt,
    })
    .run()

  return {
    id,
    userId: input.userId,
    orgId: input.orgId,
    type: input.type,
    title: input.title,
    body: input.body,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    read: false,
    createdAt: createdAt.toISOString(),
  }
}

function createNotificationRealtimeEvent(notification: NotificationRecord): NotificationRealtimeEvent {
  return {
    kind: 'notification.created',
    notification,
  }
}

function resolveMentionedUserIds(
  orgId: string,
  text: string,
  excludedUserIds: string[],
): string[] {
  const handles = extractMentionHandles(text)
  if (handles.length === 0) return []

  const memberRows = db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.organizationId, orgId))
    .all()
  const userIds = memberRows.map((row) => row.userId)
  if (userIds.length === 0) return []

  const userRows = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, userIds))
    .all()

  const excluded = new Set(excludedUserIds)
  const mentioned = new Set<string>()
  for (const user of userRows) {
    if (excluded.has(user.id)) continue
    const candidates = new Set<string>()
    const emailLocal = user.email.split('@')[0]?.trim().toLowerCase()
    if (emailLocal) candidates.add(emailLocal)
    const slug = slugifyHandle(user.name ?? '')
    if (slug) candidates.add(slug)

    for (const candidate of candidates) {
      if (handles.includes(candidate)) {
        mentioned.add(user.id)
      }
    }
  }

  return Array.from(mentioned)
}

function resolveActorName(actorId: string | null): string {
  if (!actorId) return 'Someone'

  const actor = db
    .select({
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, actorId))
    .get()

  return actor?.name?.trim() || actor?.email || 'Someone'
}

function cleanupOldWebhookDeliveries(): void {
  if (!Number.isFinite(WEBHOOK_DELIVERY_RETENTION_DAYS) || WEBHOOK_DELIVERY_RETENTION_DAYS <= 0)
    return
  try {
    const cutoff = new Date(Date.now() - WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    db.delete(webhookDeliveries)
      .where(sql`${webhookDeliveries.createdAt} < ${cutoff}`)
      .run()
  } catch {
    // keep server running
  }
}

let pushRealtimeNotification: (userId: string, event: NotificationRealtimeEvent) => void = () => {}

const syncServer = createSyncServer({
  auth: process.env.BETTER_AUTH_URL
    ? {
        verifyToken,
        verifySessionCookie,
        checkPermission,
      }
    : undefined,
  snapshotIntervalMs:
    Number.isFinite(SNAPSHOT_INTERVAL_MS) && SNAPSHOT_INTERVAL_MS > 0
      ? SNAPSHOT_INTERVAL_MS
      : 300_000,
  snapshotCallback: async (docId, snapshot, lastEditUserId, lastEditSource) => {
    db.insert(documentSnapshots)
      .values({
        id: crypto.randomUUID(),
        documentId: docId,
        snapshot: Buffer.from(snapshot),
        createdAt: new Date(),
        createdBy: lastEditUserId,
        isAgentEdit: lastEditSource === 'daemon',
        label: null,
      })
      .run()

    // Update FTS5 search index with latest content
    try {
      const doc = db
        .select({ title: documents.title })
        .from(documents)
        .where(eq(documents.id, docId))
        .get()
      if (doc) {
        const ydoc = new Y.Doc()
        Y.applyUpdate(ydoc, snapshot)
        const content = ydoc.getText('codemirror').toString()
        ydoc.destroy()

        const sqlite = getSqlite()
        sqlite.prepare('DELETE FROM document_search WHERE document_id = ?').run(docId)
        sqlite
          .prepare('INSERT INTO document_search (document_id, title, content) VALUES (?, ?, ?)')
          .run(docId, doc.title, content)
      }
    } catch {
      // Best-effort search indexing; do not break snapshot persistence
    }
  },
  snapshotLoader: async (docId) => {
    try {
      const latest = db
        .select({
          snapshot: documentSnapshots.snapshot,
        })
        .from(documentSnapshots)
        .where(eq(documentSnapshots.documentId, docId))
        .orderBy(desc(documentSnapshots.createdAt))
        .get()

      if (!latest?.snapshot) return null
      return new Uint8Array(latest.snapshot)
    } catch {
      // Table may not exist yet during startup — treat as empty
      return null
    }
  },
  eventCallback: async (event) => {
    const document = db
      .select({
        id: documents.id,
        orgId: documents.orgId,
        ownerId: documents.ownerId,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.id, event.documentId))
      .get()
    if (!document) return

    const createAndPushNotification = (input: {
      userId: string
      type: NotificationType
      title: string
      body: string
      resourceId?: string
      resourceType?: NotificationResourceType
    }) => {
      const notification = createNotificationRow({
        userId: input.userId,
        orgId: document.orgId,
        type: input.type,
        title: input.title,
        body: input.body,
        resourceId: input.resourceId ?? document.id,
        resourceType: input.resourceType ?? 'document',
      })
      pushRealtimeNotification(input.userId, createNotificationRealtimeEvent(notification))
    }

    const sendMentionNotifications = async (text: string) => {
      const mentionUserIds = resolveMentionedUserIds(document.orgId, text, [event.actorId ?? ''])
      for (const userId of mentionUserIds) {
        createAndPushNotification({
          userId,
          type: 'mention',
          title: `You were mentioned in ${document.title}`,
          body: truncateText(text),
        })
      }

      await sendMentionEmails({
        userIds: mentionUserIds,
        actorName: resolveActorName(event.actorId),
        documentId: document.id,
        documentTitle: document.title,
        excerpt: truncateText(text, 280),
      })
    }

    if (event.eventType === 'comment.created') {
      if (document.ownerId && document.ownerId !== event.actorId) {
        createAndPushNotification({
          userId: document.ownerId,
          type: 'document_comment',
          title: `New comment on ${document.title}`,
          body: truncateText(String(event.data?.text ?? '')),
        })
      }

      await sendMentionNotifications(String(event.data?.text ?? ''))
    }

    if (event.eventType === 'comment.replied') {
      const commentAuthorId = typeof event.data?.commentAuthorId === 'string' ? event.data.commentAuthorId : ''
      const replyText = String(event.data?.text ?? '')
      if (commentAuthorId && commentAuthorId !== event.actorId) {
        createAndPushNotification({
          userId: commentAuthorId,
          type: 'comment_reply',
          title: `New reply in ${document.title}`,
          body: truncateText(replyText),
        })
      }

      await sendMentionNotifications(replyText)
    }

    if (event.eventType === 'suggestion.created' && document.ownerId && document.ownerId !== event.actorId) {
      createAndPushNotification({
        userId: document.ownerId,
        type: 'suggestion_pending',
        title: `Suggestion pending review in ${document.title}`,
        body: 'An agent or collaborator proposed a change.',
      })
    }

    const targets = db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.orgId, document.orgId), eq(webhooks.active, true)))
      .all()
      .filter((webhook) => {
        let invalidEvents = false
        const subscribed = webhookSubscribedToEvent(webhook.events, event.eventType, {
          onInvalidJson: () => {
            invalidEvents = true
          },
        })

        if (invalidEvents) {
          if (!warnedInvalidWebhookEvents.has(webhook.id)) {
            warnedInvalidWebhookEvents.add(webhook.id)
            console.warn(`[webhooks] Invalid events JSON for webhook ${webhook.id}; skipping.`)
          }
          return false
        }

        warnedInvalidWebhookEvents.delete(webhook.id)
        return subscribed
      })

    if (targets.length === 0) return

    const payload = {
      eventType: event.eventType,
      documentId: event.documentId,
      orgId: document.orgId,
      actorId: event.actorId,
      actorSource: event.actorSource ?? 'browser',
      timestamp: event.timestamp,
      data: event.data ?? {},
    }

    for (const webhook of targets) {
      const secret = decryptWebhookSecret(webhook.secret)
      if (!secret) {
        console.warn(
          `[webhooks] Could not decrypt secret for webhook ${webhook.id}; skipping delivery.`,
        )
        continue
      }

      if (!isEncryptedWebhookSecret(webhook.secret)) {
        try {
          db.update(webhooks)
            .set({ secret: encryptWebhookSecret(secret) })
            .where(eq(webhooks.id, webhook.id))
            .run()
        } catch {
          // best effort migration for legacy plaintext webhook secrets
        }
      }

      dispatchWebhookWithRetry(
        {
          webhook: { id: webhook.id, url: webhook.url, secret },
          eventType: event.eventType,
          payloadObject: payload,
        },
        {
          recordDelivery: recordWebhookDelivery,
          fetchFn: limitedWebhookFetch,
        },
      )
    }
  },
})

const { server, pushNotificationToUser } = syncServer
pushRealtimeNotification = pushNotificationToUser

server.listen(PORT, () => {
  console.log(`sync-server listening on port ${PORT}`)
})

cleanupOldWebhookDeliveries()
if (
  Number.isFinite(WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS) &&
  WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS > 0
) {
  const cleanupTimer = setInterval(
    cleanupOldWebhookDeliveries,
    WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS,
  )
  cleanupTimer.unref()
}
