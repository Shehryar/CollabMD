import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db, users, eq } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { checkPermission, writeTuple, deleteTuple, readTuples } from '@collabmd/shared'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(`user:${session.user.id}:mutation`, 100, 60_000)
  if (!rl.success) return rateLimitResponse(rl, 100)

  const { id: docId } = await params
  const userId = session.user.id

  const canEdit = await checkPermission(userId, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { email, role } = body as { email: string; role: 'viewer' | 'commenter' | 'editor' }

  if (!email || !['viewer', 'commenter', 'editor'].includes(role)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const targetUser = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get()

  if (!targetUser) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
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

  const userRows = uniqueUserIds.length > 0
    ? uniqueUserIds.map((uid) =>
        db.select().from(users).where(eq(users.id, uid)).get()
      ).filter(Boolean)
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

  const { id: docId } = await params
  const currentUserId = session.user.id

  const canEdit = await checkPermission(currentUserId, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { userId, role } = body as { userId: string; role: string }

  if (!userId || !role) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  await deleteTuple(`user:${userId}`, role, `document:${docId}`)

  return NextResponse.json({ ok: true })
}
