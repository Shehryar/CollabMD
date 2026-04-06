import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import {
  db,
  documents,
  users,
  pendingResourceInvites,
  eq,
  and,
  getUserEmailNotificationPreference,
} from '@collabmd/db'
import { auth } from '@/lib/auth'
import { checkPermission, writeTuple, deleteTuple, readTuples } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'
import { createAndBroadcastNotification } from '@/lib/notification-service'
import { sendShareInviteEmail } from '@/lib/notification-email-service'
import { buildPendingInviteSignupUrl } from '@/lib/pending-resource-invites'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id: docId } = await params
  const userId = session.user.id

  const canEdit = await checkPermission(userId, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    email,
    role,
    sendEmail = true,
  } = body as {
    email: string
    role: 'viewer' | 'commenter' | 'editor'
    sendEmail?: boolean
  }

  if (!email || !['viewer', 'commenter', 'editor'].includes(role)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const targetUser = await db.select().from(users).where(eq(users.email, normalizedEmail)).get()
  const document = await db
    .select({ title: documents.title, orgId: documents.orgId })
    .from(documents)
    .where(eq(documents.id, docId))
    .get()

  if (!document) {
    return NextResponse.json({ error: 'document not found' }, { status: 404 })
  }

  if (!targetUser) {
    await db
      .delete(pendingResourceInvites)
      .where(
        and(
          eq(pendingResourceInvites.email, normalizedEmail),
          eq(pendingResourceInvites.resourceType, 'document'),
          eq(pendingResourceInvites.resourceId, docId),
        ),
      )
      .run()

    const pendingInviteId = crypto.randomUUID()
    await db.insert(pendingResourceInvites).values({
      id: pendingInviteId,
      email: normalizedEmail,
      resourceType: 'document',
      resourceId: docId,
      orgId: document.orgId,
      role,
      inviterId: userId,
      createdAt: Date.now(),
    })

    const inviteUrl = buildPendingInviteSignupUrl({
      baseUrl: process.env.BETTER_AUTH_URL || request.nextUrl.origin,
      resourceType: 'document',
      resourceId: docId,
    })

    if (sendEmail) {
      await sendShareInviteEmail({
        to: normalizedEmail,
        inviterName: session.user.name ?? session.user.email,
        resourceName: document.title,
        resourceType: 'document',
        resourceId: docId,
        preference: 'all',
        baseUrl: process.env.BETTER_AUTH_URL || request.nextUrl.origin,
        resourceUrlOverride: inviteUrl,
        actionLabel: 'Create account to open document',
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

  await writeTuple(`user:${targetUser.id}`, role, `document:${docId}`, {
    actorId: userId,
    source: 'document-share',
  })

  if (targetUser.id !== userId) {
    await createAndBroadcastNotification({
      userId: targetUser.id,
      orgId: document.orgId,
      type: 'share_invite',
      title: 'Document shared with you',
      body: `${session.user.name ?? session.user.email} shared ${document.title} with you.`,
      resourceId: docId,
      resourceType: 'document',
    })

    await sendShareInviteEmail({
      to: targetUser.email,
      inviterName: session.user.name ?? session.user.email,
      resourceName: document.title,
      resourceType: 'document',
      resourceId: docId,
      preference: getUserEmailNotificationPreference(targetUser.id),
      baseUrl: process.env.BETTER_AUTH_URL || request.nextUrl.origin,
    })
  }

  return NextResponse.json({ ok: true, pending: false, userId: targetUser.id, role })
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id: docId } = await params
  const userId = session.user.id

  const canEdit = await checkPermission(userId, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const tuples = await readTuples(`document:${docId}`)

  const userTuples = tuples.filter((t) => t.user.startsWith('user:'))
  const userIds = userTuples.map((t) => t.user.replace('user:', ''))
  const uniqueUserIds = [...new Set(userIds)]

  const userRows =
    uniqueUserIds.length > 0
      ? (await Promise.all(
          uniqueUserIds.map((uid) => db.select().from(users).where(eq(users.id, uid)).get()),
        )).filter(Boolean)
      : []

  const userMap = new Map(userRows.map((u) => [u!.id, u!]))

  const collaborators = userTuples.map((t) => {
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
        eq(pendingResourceInvites.resourceType, 'document'),
        eq(pendingResourceInvites.resourceId, docId),
      ),
    )
    .all()

  return NextResponse.json([
    ...collaborators,
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

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id: docId } = await params
  const currentUserId = session.user.id

  const canEdit = await checkPermission(currentUserId, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { userId, invitationId, role } = body as {
    userId?: string
    invitationId?: string
    role?: string
  }

  if (!role || !['viewer', 'commenter', 'editor'].includes(role)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  if (invitationId) {
    await db
      .delete(pendingResourceInvites)
      .where(
        and(
          eq(pendingResourceInvites.id, invitationId),
          eq(pendingResourceInvites.resourceType, 'document'),
          eq(pendingResourceInvites.resourceId, docId),
        ),
      )
      .run()

    return NextResponse.json({ ok: true })
  }

  if (!userId) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  await deleteTuple(`user:${userId}`, role, `document:${docId}`, {
    actorId: currentUserId,
    source: 'document-unshare',
  })

  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id: docId } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    userId: targetUserId,
    invitationId,
    oldRole,
    newRole,
  } = body as {
    userId?: string
    invitationId?: string
    oldRole?: string
    newRole?: string
  }

  if (!oldRole || !newRole) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  if (!['viewer', 'commenter', 'editor'].includes(newRole)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }

  if (invitationId) {
    await db
      .update(pendingResourceInvites)
      .set({ role: newRole })
      .where(
        and(
          eq(pendingResourceInvites.id, invitationId),
          eq(pendingResourceInvites.resourceType, 'document'),
          eq(pendingResourceInvites.resourceId, docId),
        ),
      )
      .run()

    return NextResponse.json({ success: true })
  }

  if (!targetUserId) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const isOwner = await checkPermission(targetUserId, 'owner', 'document', docId)
  if (isOwner) {
    return NextResponse.json({ error: 'cannot change owner role' }, { status: 400 })
  }

  await deleteTuple(`user:${targetUserId}`, oldRole, `document:${docId}`, {
    actorId: session.user.id,
    source: 'document-share',
  })
  await writeTuple(`user:${targetUserId}`, newRole, `document:${docId}`, {
    actorId: session.user.id,
    source: 'document-share',
  })

  return NextResponse.json({ success: true })
}
