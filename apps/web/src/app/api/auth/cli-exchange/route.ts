import { NextRequest, NextResponse } from 'next/server'
import { consumeCliAuthCode } from '@/lib/cli-auth'
import { requireJsonContentType } from '@/lib/http'
import { rateLimit, rateLimitResponse, getClientIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const ip = getClientIp(request)
  const rl = rateLimit(`ip:${ip}:cli-exchange`, 10, 60_000)
  if (!rl.success) return rateLimitResponse(rl, 10)

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 })
  }

  const record = consumeCliAuthCode(code)
  if (!record) {
    return NextResponse.json({ error: 'invalid or expired code' }, { status: 401 })
  }

  return NextResponse.json({
    token: record.sessionToken,
    userId: record.userId,
    email: record.email,
    name: record.name,
  })
}
