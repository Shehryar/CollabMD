import { db, pendingResourceInvites, eq } from '@collabmd/db'
import { writeTuple } from '@collabmd/shared'

export async function applyPendingResourceInvitesForUser(user: {
  id: string
  email: string
}): Promise<void> {
  const normalizedEmail = user.email.trim().toLowerCase()
  if (!normalizedEmail) return

  const invites = await db
    .select()
    .from(pendingResourceInvites)
    .where(eq(pendingResourceInvites.email, normalizedEmail))
    .all()

  for (const invite of invites) {
    await writeTuple(`user:${user.id}`, invite.role, `${invite.resourceType}:${invite.resourceId}`, {
      actorId: user.id,
      source: 'invite-accept',
    })
  }

  if (invites.length > 0) {
    await db.delete(pendingResourceInvites).where(eq(pendingResourceInvites.email, normalizedEmail)).run()
  }
}

export function buildPendingInviteSignupUrl(input: {
  baseUrl: string
  resourceType: 'document' | 'folder'
  resourceId: string
}): string {
  const baseUrl = input.baseUrl.replace(/\/+$/, '')
  const callbackURL =
    input.resourceType === 'document'
      ? `/doc/${input.resourceId}`
      : `/?folder=${encodeURIComponent(input.resourceId)}`

  return `${baseUrl}/signup?callbackURL=${encodeURIComponent(callbackURL)}`
}
