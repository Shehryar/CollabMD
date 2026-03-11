import {
  buildShareInviteEmail,
  shouldSendNotificationEmail,
  type EmailNotificationPreference,
} from '@collabmd/shared'

const DEFAULT_FROM = 'CollabMD <onboarding@resend.dev>'

function normalizeBaseUrl(baseUrl?: string): string {
  return (process.env.BETTER_AUTH_URL ?? baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '')
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
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[email] Failed to send notification email (${res.status}): ${body}`)
  }
}

export async function sendShareInviteEmail(input: {
  to: string
  inviterName: string
  resourceName: string
  resourceType: 'document' | 'folder'
  resourceId: string
  preference: EmailNotificationPreference
  baseUrl?: string
}): Promise<void> {
  if (!shouldSendNotificationEmail(input.preference, 'share_invite')) return

  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const resourceUrl =
    input.resourceType === 'document'
      ? `${baseUrl}/doc/${input.resourceId}`
      : `${baseUrl}/?folder=${encodeURIComponent(input.resourceId)}`

  const email = buildShareInviteEmail({
    inviterName: input.inviterName,
    resourceName: input.resourceName,
    resourceType: input.resourceType,
    resourceUrl,
    preferencesUrl: `${baseUrl}/settings/notifications`,
  })

  await sendEmail({
    to: input.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  })
}
