import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import crypto from 'node:crypto'
import { scryptSync } from 'node:crypto'
import { db, shareLinks, eq } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { checkPermission } from '@collabmd/shared'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'

type RouteParams = { params: Promise<{ id: string }> }
const VALID_PERMISSIONS = new Set(['viewer', 'commenter', 'editor'])

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
    permission = 'viewer',
    password,
    expiresInDays,
  } = body as {
    permission?: 'viewer' | 'commenter' | 'editor'
    password?: string
    expiresInDays?: number
  }

  if (!VALID_PERMISSIONS.has(permission)) {
    return NextResponse.json({ error: 'invalid permission' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  const token = crypto.randomBytes(32).toString('base64url')

  let passwordHash: string | null = null
  if (password) {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = scryptSync(password, salt, 64)
    passwordHash = `${salt}:${hash.toString('hex')}`
  }

  const now = new Date()
  const expiresAt = expiresInDays
    ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
    : null

  db.insert(shareLinks)
    .values({
      id,
      documentId: docId,
      token,
      permission,
      passwordHash,
      expiresAt,
      createdBy: userId,
      createdAt: now,
    })
    .run()

  return NextResponse.json(
    {
      id,
      token,
      permission,
      expiresAt: expiresAt?.toISOString() ?? null,
      createdAt: now.toISOString(),
    },
    { status: 201 },
  )
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

  const links = db.select().from(shareLinks).where(eq(shareLinks.documentId, docId)).all()

  const result = links.map((link) => ({
    id: link.id,
    token: link.token,
    permission: link.permission,
    hasPassword: link.passwordHash !== null,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    createdBy: link.createdBy,
    createdAt: link.createdAt.toISOString(),
  }))

  return NextResponse.json(result)
}
