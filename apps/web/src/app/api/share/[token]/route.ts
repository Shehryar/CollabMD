import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { db, shareLinks, eq } from '@collabmd/db'
import { writeTuple } from '@collabmd/shared'
import { auth } from '@/lib/auth'
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

  const link = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()

  if (!link) {
    console.warn(`[share-link] token not found ip=${ip}`)
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  if (link.expiresAt && link.expiresAt < Date.now()) {
    console.warn(`[share-link] expired linkId=${link.id} docId=${link.documentId} ip=${ip}`)
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }

  if (link.passwordHash) {
    // Per-token rate limit: 5 password attempts per 15 minutes
    const tokenRl = rateLimit(`share-token:${link.id}:password`, 5, 15 * 60_000)
    if (!tokenRl.success) return rateLimitResponse(tokenRl, 5)

    const body = await request.json().catch(() => ({}))
    const { password } = body as { password?: string }

    if (!password) {
      console.info(`[share-link] password required linkId=${link.id} docId=${link.documentId} ip=${ip}`)
      return NextResponse.json({ error: 'password required' }, { status: 401 })
    }

    if (!verifyPassword(password, link.passwordHash)) {
      console.warn(`[share-link] wrong password linkId=${link.id} docId=${link.documentId} ip=${ip}`)
      return NextResponse.json({ error: 'wrong password' }, { status: 403 })
    }
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user.id) {
    console.info(
      `[share-link] granting access linkId=${link.id} docId=${link.documentId} userId=${session.user.id} permission=${link.permission}`,
    )
    await writeTuple(`user:${session.user.id}`, link.permission, `document:${link.documentId}`, {
      actorId: session.user.id,
      source: 'share-link',
    })
  } else {
    console.info(
      `[share-link] validated without session linkId=${link.id} docId=${link.documentId} permission=${link.permission}`,
    )
  }

  return NextResponse.json({
    documentId: link.documentId,
    permission: link.permission,
  })
}
