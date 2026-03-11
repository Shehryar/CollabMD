export const emailNotificationPreferences = ['all', 'mentions', 'none'] as const

export type EmailNotificationPreference = (typeof emailNotificationPreferences)[number]
export type EmailNotificationKind = 'share_invite' | 'mention'

export function isEmailNotificationPreference(
  value: unknown,
): value is EmailNotificationPreference {
  return emailNotificationPreferences.includes(value as EmailNotificationPreference)
}

export function shouldSendNotificationEmail(
  preference: EmailNotificationPreference,
  kind: EmailNotificationKind,
): boolean {
  if (preference === 'none') return false
  if (preference === 'all') return true
  return kind === 'mention'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

interface EmailTemplate {
  subject: string
  text: string
  html: string
}

export function buildShareInviteEmail(input: {
  inviterName: string
  resourceName: string
  resourceType: 'document' | 'folder'
  resourceUrl: string
  preferencesUrl: string
}): EmailTemplate {
  const subject = `${input.inviterName} shared a ${input.resourceType} with you`
  const resourceLabel = `${input.resourceType === 'document' ? 'Document' : 'Folder'}: ${input.resourceName}`
  const actionLabel = input.resourceType === 'document' ? 'Open document' : 'Open folder'
  const text = [
    `${input.inviterName} shared a ${input.resourceType} with you in CollabMD.`,
    resourceLabel,
    '',
    `${actionLabel}: ${input.resourceUrl}`,
    `Unsubscribe or manage notification emails: ${input.preferencesUrl}`,
  ].join('\n')

  const html = `
    <div style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f1f1b; line-height: 1.5;">
      <h1 style="margin: 0 0 16px; font-size: 20px;">${escapeHtml(input.inviterName)} shared a ${escapeHtml(input.resourceType)} with you</h1>
      <p style="margin: 0 0 12px;">${escapeHtml(input.inviterName)} shared a ${escapeHtml(input.resourceType)} with you in CollabMD.</p>
      <p style="margin: 0 0 20px; color: #5f5a55;"><strong>${escapeHtml(resourceLabel)}</strong></p>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.resourceUrl)}" style="display: inline-block; border: 1px solid #c2682b; background: #c2682b; color: #f7f7f5; text-decoration: none; padding: 10px 14px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 12px;">${escapeHtml(actionLabel)}</a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #6c655f;">
        <a href="${escapeHtml(input.preferencesUrl)}" style="color: #6c655f;">Unsubscribe or manage notification emails</a>
      </p>
    </div>
  `.trim()

  return { subject, text, html }
}

export function buildCommentMentionEmail(input: {
  actorName: string
  documentTitle: string
  excerpt: string
  documentUrl: string
  preferencesUrl: string
}): EmailTemplate {
  const subject = `${input.actorName} mentioned you in ${input.documentTitle}`
  const text = [
    `${input.actorName} mentioned you in ${input.documentTitle}.`,
    '',
    input.excerpt,
    '',
    `Open document: ${input.documentUrl}`,
    `Unsubscribe or manage notification emails: ${input.preferencesUrl}`,
  ].join('\n')

  const html = `
    <div style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f1f1b; line-height: 1.5;">
      <h1 style="margin: 0 0 16px; font-size: 20px;">${escapeHtml(input.actorName)} mentioned you</h1>
      <p style="margin: 0 0 12px;">${escapeHtml(input.actorName)} mentioned you in <strong>${escapeHtml(input.documentTitle)}</strong>.</p>
      <blockquote style="margin: 0 0 20px; padding: 12px 14px; border-left: 3px solid #c2682b; background: #f7f7f5; color: #4e4843;">
        ${escapeHtml(input.excerpt)}
      </blockquote>
      <p style="margin: 0 0 20px;">
        <a href="${escapeHtml(input.documentUrl)}" style="display: inline-block; border: 1px solid #c2682b; background: #c2682b; color: #f7f7f5; text-decoration: none; padding: 10px 14px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 12px;">Open document</a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #6c655f;">
        <a href="${escapeHtml(input.preferencesUrl)}" style="color: #6c655f;">Unsubscribe or manage notification emails</a>
      </p>
    </div>
  `.trim()

  return { subject, text, html }
}
