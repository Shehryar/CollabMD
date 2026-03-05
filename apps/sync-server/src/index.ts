import { createSyncServer } from './server.js'
import { verifyToken, verifySessionCookie } from './auth.js'
import { checkPermission } from '@collabmd/shared'
import crypto from 'node:crypto'
import {
  db,
  documentSnapshots,
  documents,
  webhooks,
  webhookDeliveries,
  and,
  eq,
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

const { server } = createSyncServer({
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
      })
      .from(documents)
      .where(eq(documents.id, event.documentId))
      .get()
    if (!document) return

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
