import {
  db,
  getUserEmailNotificationPreferences,
  inArray,
  users,
} from '@collabmd/db'
import { buildCommentMentionEmail, shouldSendNotificationEmail } from '@collabmd/shared'

const DEFAULT_FROM = 'CollabMD <onboarding@resend.dev>'

function normalizeBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}

async function sendEmail(input: {
  to: string
  subject: string
  text: string
  html: string
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n=== EMAIL ===\nTo: ${input.to}\nSubject: ${input.subject}\n\n${input.text}\n=============\n`)
    }
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[email] Failed to send mention email (${res.status}): ${body}`)
  }
}

export async function sendMentionEmails(input: {
  userIds: string[]
  actorName: string
  documentId: string
  documentTitle: string
  excerpt: string
}): Promise<void> {
  const payloads = buildMentionEmailPayloads(input)
  await Promise.allSettled(payloads.map((payload) => sendEmail(payload)))
}

export function buildMentionEmailPayloads(input: {
  userIds: string[]
  actorName: string
  documentId: string
  documentTitle: string
  excerpt: string
}): Array<{
  to: string
  subject: string
  text: string
  html: string
}> {
  const uniqueUserIds = Array.from(new Set(input.userIds.filter((value) => value.trim().length > 0)))
  if (uniqueUserIds.length === 0) return []

  const preferences = getUserEmailNotificationPreferences(uniqueUserIds)
  const recipients = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, uniqueUserIds))
    .all()

  const baseUrl = normalizeBaseUrl()
  return recipients.flatMap((recipient) => {
    const preference = preferences.get(recipient.id) ?? 'all'
    if (!shouldSendNotificationEmail(preference, 'mention')) return []

    const email = buildCommentMentionEmail({
      actorName: input.actorName,
      documentTitle: input.documentTitle,
      excerpt: input.excerpt,
      documentUrl: `${baseUrl}/doc/${input.documentId}`,
      preferencesUrl: `${baseUrl}/settings/notifications`,
    })

    return [
      {
        to: recipient.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      },
    ]
  })
}
