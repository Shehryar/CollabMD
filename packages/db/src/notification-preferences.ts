import { eq, inArray } from 'drizzle-orm'
import { db, isPostgres } from './client.js'
import * as sqliteSchema from './schema.js'
import * as pgSchema from './schema-pg.js'

// Use the correct dialect's table at runtime, but type as SQLite for compile-time compatibility
const userNotificationPreferences = (
  isPostgres ? pgSchema.userNotificationPreferences : sqliteSchema.userNotificationPreferences
) as typeof sqliteSchema.userNotificationPreferences

export const emailNotificationPreferences = ['all', 'mentions', 'none'] as const

export type EmailNotificationPreference = (typeof emailNotificationPreferences)[number]

export const DEFAULT_EMAIL_NOTIFICATION_PREFERENCE: EmailNotificationPreference = 'all'

function normalizePreference(value: unknown): EmailNotificationPreference {
  return emailNotificationPreferences.includes(value as EmailNotificationPreference)
    ? (value as EmailNotificationPreference)
    : DEFAULT_EMAIL_NOTIFICATION_PREFERENCE
}

export function getUserEmailNotificationPreference(userId: string): EmailNotificationPreference {
  if (isPostgres) {
    throw new Error(
      'getUserEmailNotificationPreference() is synchronous and not available in Postgres mode. Use getUserEmailNotificationPreferenceAsync() instead.',
    )
  }

  const row = db
    .select({ emailNotifications: userNotificationPreferences.emailNotifications })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .get()

  return normalizePreference(row?.emailNotifications)
}

export async function getUserEmailNotificationPreferenceAsync(
  userId: string,
): Promise<EmailNotificationPreference> {
  const rows = await db
    .select({ emailNotifications: userNotificationPreferences.emailNotifications })
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))

  return normalizePreference(rows[0]?.emailNotifications)
}

export function getUserEmailNotificationPreferences(
  userIds: string[],
): Map<string, EmailNotificationPreference> {
  if (isPostgres) {
    throw new Error(
      'getUserEmailNotificationPreferences() is synchronous and not available in Postgres mode. Use getUserEmailNotificationPreferencesAsync() instead.',
    )
  }

  const uniqueUserIds = Array.from(
    new Set(userIds.filter((value: string) => value.trim().length > 0)),
  )
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

export async function getUserEmailNotificationPreferencesAsync(
  userIds: string[],
): Promise<Map<string, EmailNotificationPreference>> {
  const uniqueUserIds = Array.from(
    new Set(userIds.filter((value: string) => value.trim().length > 0)),
  )
  if (uniqueUserIds.length === 0) return new Map()

  const rows = await db
    .select({
      userId: userNotificationPreferences.userId,
      emailNotifications: userNotificationPreferences.emailNotifications,
    })
    .from(userNotificationPreferences)
    .where(inArray(userNotificationPreferences.userId, uniqueUserIds))

  return new Map(
    rows.map((row) => [row.userId, normalizePreference(row.emailNotifications)]),
  )
}

export async function setUserEmailNotificationPreference(
  userId: string,
  preference: EmailNotificationPreference,
): Promise<EmailNotificationPreference> {
  const now = new Date()

  await db
    .insert(userNotificationPreferences)
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

  return preference
}
