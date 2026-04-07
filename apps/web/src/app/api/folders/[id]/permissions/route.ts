import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import {
  db,
  folders,
  users,
  pendingResourceInvites,
  inArray,
  eq,
  and,
  getUserEmailNotificationPreferenceAsync,
} from '@collabmd/db'
import { checkPermission, writeTuple, deleteTuple, readTuples } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'
import { createAndBroadcastNotification } from '@/lib/notification-service'
import { sendShareInviteEmail } from '@/lib/notification-email-service'
import { buildPendingInviteSignupUrl } from '@/lib/pending-resource-invites'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id)
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'folder', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    userId: targetUserId,
    email,
    role,
    sendEmail = true,
  } = body as {
    userId?: string
    email?: string
    role?: 'editor' | 'viewer'
    sendEmail?: boolean
  }

  if ((!targetUserId && !email) || !role || !['editor', 'viewer'].includes(role)) {
    return NextResponse.json(
      { error: 'userId or email and role (editor|viewer) are required' },
      { status: 400 },
    )
  }

  const folder = await db
    .select({ name: folders.name, orgId: folders.orgId })
    .from(folders)
    .where(eq(folders.id, id))
    .get()
  if (!folder) {
    return NextResponse.json({ error: 'folder not found' }, { status: 404 })
  }

  const normalizedEmail = email?.trim().toLowerCase()
  const targetUser = targetUserId
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, targetUserId))
        .get()
    : normalizedEmail
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .get()
      : null

  if (!targetUser && normalizedEmail) {
    await db
      .delete(pendingResourceInvites)
      .where(
        and(
          eq(pendingResourceInvites.email, normalizedEmail),
          eq(pendingResourceInvites.resourceType, 'folder'),
          eq(pendingResourceInvites.resourceId, id),
        ),
      )
      .run()

    const pendingInviteId = crypto.randomUUID()
    await db.insert(pendingResourceInvites).values({
      id: pendingInviteId,
      email: normalizedEmail,
      resourceType: 'folder',
      resourceId: id,
      orgId: folder.orgId,
      role,
      inviterId: session.user.id,
      createdAt: Date.now(),
    })

    const inviteUrl = buildPendingInviteSignupUrl({
      baseUrl: process.env.BETTER_AUTH_URL || request.nextUrl.origin,
      resourceType: 'folder',
      resourceId: id,
    })

    if (sendEmail) {
      await sendShareInviteEmail({
        to: normalizedEmail,
        inviterName: session.user.name ?? session.user.email,
        resourceName: folder.name,
        resourceType: 'folder',
        resourceId: id,
        preference: 'all',
        baseUrl: process.env.BETTER_AUTH_URL || request.nextUrl.origin,
        resourceUrlOverride: inviteUrl,
        actionLabel: 'Create account to open folder',
      })
    }

    return NextResponse.json({
      ok: true,
      pending: true,
      invitationId: pendingInviteId,
      inviteUrl,
      role,
      emailSent: sendEmail,
    })
  }

  if (!targetUser) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 })
  }

  await writeTuple(`user:${targetUser.id}`, role, `folder:${id}`, {
    actorId: session.user.id,
    source: 'folder-share',
  })

  if (targetUser.id !== session.user.id) {
    await createAndBroadcastNotification({
      userId: targetUser.id,
      orgId: folder.orgId,
      type: 'share_invite',
      title: 'Folder shared with you',
      body: `${session.user.name ?? session.user.email} shared ${folder.name} with you.`,
      resourceId: id,
      resourceType: 'folder',
    })

    await sendShareInviteEmail({
      to: targetUser.email,
      inviterName: session.user.name ?? session.user.email,
      resourceName: folder.name,
      resourceType: 'folder',
      resourceId: id,
      preference: await getUserEmailNotificationPreferenceAsync(targetUser.id),
      baseUrl: process.env.BETTER_AUTH_URL || request.nextUrl.origin,
    })
  }

  return NextResponse.json({ ok: true, pending: false })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'folder', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const tuples = await readTuples(`folder:${id}`)

  // Filter to direct user relations only
  const userTuples = tuples.filter(
    (t) => t.user.startsWith('user:') && ['owner', 'editor', 'viewer'].includes(t.relation),
  )

  const userIds = userTuples.map((t) => t.user.replace('user:', ''))
  const userRecords = userIds.length > 0 ? await db.select().from(users).where(inArray(users.id, userIds)).all() : []
  const userMap = new Map(userRecords.map((u) => [u.id, u]))

  const result = userTuples.map((t) => {
    const uid = t.user.replace('user:', '')
    const user = userMap.get(uid)
    return {
      userId: uid,
      invitationId: null,
      pending: false,
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: t.relation,
    }
  })

  const pendingInvites = await db
    .select()
    .from(pendingResourceInvites)
    .where(
      and(
        eq(pendingResourceInvites.resourceType, 'folder'),
        eq(pendingResourceInvites.resourceId, id),
      ),
    )
    .all()

  return NextResponse.json([
    ...result,
    ...pendingInvites.map((invite) => ({
      userId: null,
      invitationId: invite.id,
      pending: true,
      name: '',
      email: invite.email,
      role: invite.role,
    })),
  ])
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'folder', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    userId: targetUserId,
    invitationId,
    role,
  } = body as { userId?: string; invitationId?: string; role?: string }

  if (!role) {
    return NextResponse.json({ error: 'user id/invitation id and role are required' }, { status: 400 })
  }

  if (!['viewer', 'editor'].includes(role)) {
    return NextResponse.json({ error: 'role must be viewer or editor' }, { status: 400 })
  }

  if (invitationId) {
    await db
      .delete(pendingResourceInvites)
      .where(
        and(
          eq(pendingResourceInvites.id, invitationId),
          eq(pendingResourceInvites.resourceType, 'folder'),
          eq(pendingResourceInvites.resourceId, id),
        ),
      )
      .run()

    return NextResponse.json({ ok: true })
  }

  if (!targetUserId) {
    return NextResponse.json({ error: 'user id/invitation id and role are required' }, { status: 400 })
  }

  await deleteTuple(`user:${targetUserId}`, role, `folder:${id}`, {
    actorId: session.user.id,
    source: 'folder-unshare',
  })

  return NextResponse.json({ ok: true })
}
