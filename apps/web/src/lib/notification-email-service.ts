import {
  buildShareInviteEmail,
  shouldSendNotificationEmail,
  type EmailNotificationPreference,
} from '@collabmd/shared'

function normalizeBaseUrl(baseUrl?: string): string {
  return (process.env.BETTER_AUTH_URL ?? baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '')
}

async function sendLoopsTransactional(
  transactionalId: string,
  email: string,
  dataVariables: Record<string, string>,
): Promise<void> {
  const apiKey = process.env.LOOPS_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `\n=== EMAIL (no LOOPS_API_KEY) ===\nTo: ${email}\nTemplate: ${transactionalId}\nVars: ${JSON.stringify(dataVariables)}\n=============\n`,
      )
    }
    return
  }

  const res = await fetch('https://app.loops.so/api/v1/transactional', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ transactionalId, email, dataVariables }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[email] Loops transactional failed (${res.status}): ${body}`)
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
  resourceUrlOverride?: string
  actionLabel?: string
}): Promise<void> {
  if (!shouldSendNotificationEmail(input.preference, 'share_invite')) return

  const transactionalId = process.env.LOOPS_SHARE_INVITE_TRANSACTIONAL_ID
  if (!transactionalId) {
    // Fall back to console log in dev
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const email = buildShareInviteEmail({
      inviterName: input.inviterName,
      resourceName: input.resourceName,
      resourceType: input.resourceType,
      resourceUrl:
        input.resourceUrlOverride ??
        (input.resourceType === 'document'
          ? `${baseUrl}/doc/${input.resourceId}`
          : `${baseUrl}/?folder=${encodeURIComponent(input.resourceId)}`),
      preferencesUrl: `${baseUrl}/settings`,
      actionLabel: input.actionLabel,
    })
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n=== EMAIL ===\nTo: ${input.to}\nSubject: ${email.subject}\n\n${email.text}\n=============\n`)
    }
    return
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const resourceUrl =
    input.resourceUrlOverride ??
    (input.resourceType === 'document'
      ? `${baseUrl}/doc/${input.resourceId}`
      : `${baseUrl}/?folder=${encodeURIComponent(input.resourceId)}`)

  await sendLoopsTransactional(transactionalId, input.to, {
    inviterName: input.inviterName,
    resourceName: input.resourceName,
    resourceType: input.resourceType,
    resourceUrl,
    preferencesUrl: `${baseUrl}/settings`,
    ...(input.actionLabel ? { actionLabel: input.actionLabel } : {}),
  })
}
