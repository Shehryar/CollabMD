import { NextRequest, NextResponse } from 'next/server'
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { db, shareLinks, eq } from '@collabmd/db'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'

type RouteParams = { params: Promise<{ token: string }> }

function verifyPassword(password: string, storedHash: string): boolean {
  // New format: salt:hexDigest (scrypt)
  if (storedHash.includes(':')) {
    const [salt, digest] = storedHash.split(':')
    if (!salt || !digest) return false
    const candidate = scryptSync(password, salt, 64).toString('hex')
    if (candidate.length !== digest.length) return false
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(digest, 'hex'))
  }

  // Legacy format: unsalted SHA-256 hex.
  const legacyHash = createHash('sha256').update(password, 'utf8').digest('hex')
  if (legacyHash.length !== storedHash.length) return false
  return timingSafeEqual(Buffer.from(legacyHash, 'hex'), Buffer.from(storedHash, 'hex'))
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = rateLimit(`ip:${ip}:share`, 30, 60_000)
  if (!rl.success) return rateLimitResponse(rl, 30)

  const { token } = await params

  const link = db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.token, token))
    .get()

  if (!link) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  if (link.expiresAt && link.expiresAt < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }

  if (link.passwordHash) {
    const body = await request.json().catch(() => ({}))
    const { password } = body as { password?: string }

    if (!password) {
      return NextResponse.json({ error: 'password required' }, { status: 401 })
    }

    if (!verifyPassword(password, link.passwordHash)) {
      return NextResponse.json({ error: 'wrong password' }, { status: 403 })
    }
  }

  return NextResponse.json({
    documentId: link.documentId,
    permission: link.permission,
  })
}
