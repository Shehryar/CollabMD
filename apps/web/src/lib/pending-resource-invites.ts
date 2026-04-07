import { db, pendingResourceInvites, users, eq } from '@collabmd/db'
import { writeTuple } from '@collabmd/shared'

const DEFAULT_CLAIM_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 250

interface PendingInviteUser {
  id: string
  email: string
}

interface ApplyPendingInviteOptions {
  maxAttempts?: number
  retryDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function claimInviteWithRetry(
  user: PendingInviteUser,
  invite: {
    id: string
    role: string
    resourceType: string
    resourceId: string
  },
  options: Required<ApplyPendingInviteOptions>,
): Promise<boolean> {
  const objectRef = `${invite.resourceType}:${invite.resourceId}`

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      await writeTuple(`user:${user.id}`, invite.role, objectRef, {
        actorId: user.id,
        source: 'invite-accept',
      })
      await db.delete(pendingResourceInvites).where(eq(pendingResourceInvites.id, invite.id)).run()
      console.info(
        `[pending-invite] claimed inviteId=${invite.id} userId=${user.id} object=${objectRef} role=${invite.role}`,
      )
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error'
      const finalAttempt = attempt === options.maxAttempts
      const level = finalAttempt ? console.error : console.warn
      level(
        `[pending-invite] claim failed inviteId=${invite.id} userId=${user.id} object=${objectRef} role=${invite.role} attempt=${attempt}/${options.maxAttempts} error=${message}`,
      )
      if (!finalAttempt && options.retryDelayMs > 0) {
        await sleep(options.retryDelayMs * attempt)
      }
    }
  }

  return false
}

export async function applyPendingResourceInvitesForUser(
  user: PendingInviteUser,
  options?: ApplyPendingInviteOptions,
): Promise<{ claimed: number; failed: number }> {
  const normalizedEmail = user.email.trim().toLowerCase()
  if (!normalizedEmail) return { claimed: 0, failed: 0 }

  const invites = await db
    .select()
    .from(pendingResourceInvites)
    .where(eq(pendingResourceInvites.email, normalizedEmail))
    .all()

  if (invites.length === 0) return { claimed: 0, failed: 0 }

  const resolvedOptions: Required<ApplyPendingInviteOptions> = {
    maxAttempts: Math.max(1, options?.maxAttempts ?? DEFAULT_CLAIM_ATTEMPTS),
    retryDelayMs: Math.max(0, options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS),
  }

  let claimed = 0
  let failed = 0

  for (const invite of invites) {
    const ok = await claimInviteWithRetry(user, invite, resolvedOptions)
    if (ok) claimed += 1
    else failed += 1
  }

  return { claimed, failed }
}

export async function applyPendingResourceInvitesForUserId(
  userId: string,
  options?: ApplyPendingInviteOptions,
): Promise<{ claimed: number; failed: number }> {
  const user = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (!user) {
    console.warn(`[pending-invite] user not found for claim retry userId=${userId}`)
    return { claimed: 0, failed: 0 }
  }

  return applyPendingResourceInvitesForUser(user, options)
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
