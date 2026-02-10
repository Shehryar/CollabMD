import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import crypto from 'node:crypto'
import { db, shareLinks, eq } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { checkPermission } from '@collabmd/shared'
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
  const { permission = 'viewer', password, expiresInDays } = body as {
    permission?: 'viewer' | 'commenter' | 'editor'
    password?: string
    expiresInDays?: number
  }

  const id = crypto.randomUUID()
  const token = crypto.randomBytes(32).toString('base64url')

  let passwordHash: string | null = null
  if (password) {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  const now = new Date()
  const expiresAt = expiresInDays
    ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
    : null

  db.insert(shareLinks).values({
    id,
    documentId: docId,
    token,
    permission,
    passwordHash,
    expiresAt,
    createdBy: userId,
    createdAt: now,
  }).run()

  return NextResponse.json({
    id,
    token,
    permission,
    expiresAt: expiresAt?.toISOString() ?? null,
    createdAt: now.toISOString(),
  }, { status: 201 })
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

  const links = db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.documentId, docId))
    .all()

  const result = links.map(link => ({
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
