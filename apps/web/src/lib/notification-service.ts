import crypto from 'node:crypto'
import type {
  NotificationRealtimeEvent,
  NotificationRecord,
  NotificationResourceType,
  NotificationType,
} from '@collabmd/shared'
import { and, db, desc, eq, notifications, sql } from '@collabmd/db'
import { getSyncHttpUrl } from './sync-url'
import { getSyncInternalHeaders } from './sync-internal-auth'

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString()
}

function serializeNotification(row: {
  id: string
  userId: string
  orgId: string
  type: string
  title: string
  body: string
  resourceId: string
  resourceType: string
  read: boolean
  createdAt: number | Date
}): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    resourceId: row.resourceId,
    resourceType: row.resourceType as NotificationResourceType,
    read: row.read,
    createdAt: toIsoString(row.createdAt),
  }
}

export async function createNotification(input: {
  userId: string
  orgId: string
  type: NotificationType
  title: string
  body: string
  resourceId: string
  resourceType: NotificationResourceType
}): Promise<NotificationRecord> {
  const now = Date.now()
  const id = crypto.randomUUID()
  await db.insert(notifications)
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
      createdAt: now,
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
    createdAt: new Date(now).toISOString(),
  }
}

export async function broadcastNotificationEvent(input: {
  userId?: string
  userIds?: string[]
  event: NotificationRealtimeEvent
}): Promise<void> {
  try {
    await fetch(`${getSyncHttpUrl()}/notifications/broadcast`, {
      method: 'POST',
      headers: getSyncInternalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(input),
      cache: 'no-store',
    })
  } catch {
    // Best-effort realtime fanout.
  }
}

export async function createAndBroadcastNotification(input: {
  userId: string
  orgId: string
  type: NotificationType
  title: string
  body: string
  resourceId: string
  resourceType: NotificationResourceType
}): Promise<NotificationRecord> {
  const notification = await createNotification(input)
  await broadcastNotificationEvent({
    userId: input.userId,
    event: { kind: 'notification.created', notification },
  })
  return notification
}

export async function listNotifications(input: {
  userId: string
  orgId: string
  limit: number
  offset: number
}): Promise<{
  notifications: NotificationRecord[]
  unreadCount: number
  nextOffset: string
}> {
  const where = and(eq(notifications.userId, input.userId), eq(notifications.orgId, input.orgId))
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(input.limit)
    .offset(input.offset)
    .all()
  const unreadRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.orgId, input.orgId),
        eq(notifications.read, false),
      ),
    )
    .get()

  return {
    notifications: rows.map(serializeNotification),
    unreadCount: Number(unreadRow?.count ?? 0),
    nextOffset: rows.length === input.limit ? String(input.offset + rows.length) : '',
  }
}

export async function markNotificationRead(input: {
  id: string
  userId: string
  orgId: string
}): Promise<NotificationRecord | null> {
  const existing = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, input.id),
        eq(notifications.userId, input.userId),
        eq(notifications.orgId, input.orgId),
      ),
    )
    .get()

  if (!existing) return null

  if (!existing.read) {
    await db.update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, input.id))
      .run()
  }

  return serializeNotification({ ...existing, read: true })
}

export async function markAllNotificationsRead(input: { userId: string; orgId: string }): Promise<string[]> {
  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.orgId, input.orgId),
        eq(notifications.read, false),
      ),
    )
    .all()

  if (unread.length === 0) return []

  await db.update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.orgId, input.orgId),
        eq(notifications.read, false),
      ),
    )
    .run()

  return unread.map((row) => row.id)
}
