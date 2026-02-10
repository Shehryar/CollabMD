import { NextRequest, NextResponse } from 'next/server'
import { db, shareLinks, eq } from '@collabmd/db'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'

type RouteParams = { params: Promise<{ token: string }> }

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
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (link.expiresAt && link.expiresAt < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }

  if (link.passwordHash) {
    const body = await request.json().catch(() => ({}))
    const { password } = body as { password?: string }

    if (!password) {
      return NextResponse.json({ error: 'password_required' }, { status: 401 })
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    if (hash !== link.passwordHash) {
      return NextResponse.json({ error: 'wrong_password' }, { status: 403 })
    }
  }

  return NextResponse.json({
    documentId: link.documentId,
    permission: link.permission,
  })
}
