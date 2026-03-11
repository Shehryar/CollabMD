import { eq, inArray } from 'drizzle-orm'
import { db } from './client.js'
import { userNotificationPreferences } from './schema.js'

export const emailNotificationPreferences = ['all', 'mentions', 'none'] as const

export type EmailNotificationPreference = (typeof emailNotificationPreferences)[number]

export const DEFAULT_EMAIL_NOTIFICATION_PREFERENCE: EmailNotificationPreference = 'all'

function normalizePreference(value: unknown): EmailNotificationPreference {
  return emailNotificationPreferences.includes(value as EmailNotificationPreference)
    ? (value as EmailNotificationPreference)
    : DEFAULT_EMAIL_NOTIFICATION_PREFERENCE
}

export function getUserEmailNotificationPreference(userId: string): EmailNotificationPreference {
  const row = db
    .select({ emailNotifications: userNotificationPreferences.emailNotifications })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .get()

  return normalizePreference(row?.emailNotifications)
}

export function getUserEmailNotificationPreferences(
  userIds: string[],
): Map<string, EmailNotificationPreference> {
  const uniqueUserIds = Array.from(new Set(userIds.filter((value) => value.trim().length > 0)))
  if (uniqueUserIds.length === 0) return new Map()

  const rows = db
    .select({
      userId: userNotificationPreferences.userId,
      emailNotifications: userNotificationPreferences.emailNotifications,
    })
    .from(userNotificationPreferences)
    .where(inArray(userNotificationPreferences.userId, uniqueUserIds))
    .all()

  return new Map(
    rows.map((row) => [row.userId, normalizePreference(row.emailNotifications)]),
  )
}

export function setUserEmailNotificationPreference(
  userId: string,
  preference: EmailNotificationPreference,
): EmailNotificationPreference {
  const now = new Date()

  db.insert(userNotificationPreferences)
    .values({
      userId,
      emailNotifications: preference,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userNotificationPreferences.userId,
      set: {
        emailNotifications: preference,
        updatedAt: now,
      },
    })
    .run()

  return preference
}
