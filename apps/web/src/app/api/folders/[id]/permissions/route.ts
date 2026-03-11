import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import {
  db,
  folders,
  users,
  inArray,
  eq,
  getUserEmailNotificationPreference,
} from '@collabmd/db'
import { checkPermission, writeTuple, deleteTuple, readTuples } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'
import { createAndBroadcastNotification } from '@/lib/notification-service'
import { sendShareInviteEmail } from '@/lib/notification-email-service'

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
  const { userId: targetUserId, role } = body as { userId: string; role: 'editor' | 'viewer' }

  if (!targetUserId || !role || !['editor', 'viewer'].includes(role)) {
    return NextResponse.json(
      { error: 'user id and role (editor|viewer) are required' },
      { status: 400 },
    )
  }

  const folder = db
    .select({ name: folders.name, orgId: folders.orgId })
    .from(folders)
    .where(eq(folders.id, id))
    .get()
  if (!folder) {
    return NextResponse.json({ error: 'folder not found' }, { status: 404 })
  }

  const targetUser = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId))
    .get()
  if (!targetUser) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 })
  }

  await writeTuple(`user:${targetUserId}`, role, `folder:${id}`)

  if (targetUserId !== session.user.id) {
    await createAndBroadcastNotification({
      userId: targetUserId,
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
      preference: getUserEmailNotificationPreference(targetUserId),
      baseUrl: request.nextUrl.origin,
    })
  }

  return NextResponse.json({ ok: true })
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

  if (userTuples.length === 0) {
    return NextResponse.json([])
  }

  const userIds = userTuples.map((t) => t.user.replace('user:', ''))
  const userRecords = db.select().from(users).where(inArray(users.id, userIds)).all()
  const userMap = new Map(userRecords.map((u) => [u.id, u]))

  const result = userTuples.map((t) => {
    const uid = t.user.replace('user:', '')
    const user = userMap.get(uid)
    return {
      userId: uid,
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: t.relation,
    }
  })

  return NextResponse.json(result)
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

  const { id } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'folder', id)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { userId: targetUserId, role } = body as { userId: string; role: string }

  if (!targetUserId || !role) {
    return NextResponse.json({ error: 'user id and role are required' }, { status: 400 })
  }

  if (!['viewer', 'editor'].includes(role)) {
    return NextResponse.json({ error: 'role must be viewer or editor' }, { status: 400 })
  }

  await deleteTuple(`user:${targetUserId}`, role, `folder:${id}`)

  return NextResponse.json({ ok: true })
}
