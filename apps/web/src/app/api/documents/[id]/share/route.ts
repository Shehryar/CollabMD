import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db, users, eq } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { checkPermission, writeTuple, deleteTuple, readTuples } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

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
  const { email, role } = body as { email: string; role: 'viewer' | 'commenter' | 'editor' }

  if (!email || !['viewer', 'commenter', 'editor'].includes(role)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const targetUser = db.select().from(users).where(eq(users.email, email)).get()

  if (!targetUser) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 })
  }

  await writeTuple(`user:${targetUser.id}`, role, `document:${docId}`)

  return NextResponse.json({ ok: true, userId: targetUser.id, role })
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
      ? uniqueUserIds
          .map((uid) => db.select().from(users).where(eq(users.id, uid)).get())
          .filter(Boolean)
      : []

  const userMap = new Map(userRows.map((u) => [u!.id, u!]))

  const collaborators = userTuples.map((t) => {
    const uid = t.user.replace('user:', '')
    const user = userMap.get(uid)
    return {
      userId: uid,
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: t.relation,
    }
  })

  return NextResponse.json(collaborators)
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
  const { userId, role } = body as { userId: string; role: string }

  if (!userId || !role) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  if (!['viewer', 'commenter', 'editor'].includes(role)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  await deleteTuple(`user:${userId}`, role, `document:${docId}`)

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
    oldRole,
    newRole,
  } = body as {
    userId?: string
    oldRole?: string
    newRole?: string
  }

  if (!targetUserId || !oldRole || !newRole) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  if (!['viewer', 'commenter', 'editor'].includes(newRole)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }

  const isOwner = await checkPermission(targetUserId, 'owner', 'document', docId)
  if (isOwner) {
    return NextResponse.json({ error: 'cannot change owner role' }, { status: 400 })
  }

  await deleteTuple(`user:${targetUserId}`, oldRole, `document:${docId}`)
  await writeTuple(`user:${targetUserId}`, newRole, `document:${docId}`)

  return NextResponse.json({ success: true })
}
