import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { getClientIp, rateLimit, rateLimitResponse } from '@/lib/rate-limit'

const handlers = toNextJsHandler(auth)

function authPostRateLimit(request: NextRequest): NextResponse | null {
  const ip = getClientIp(request)
  const path = request.nextUrl.pathname

  const isMagicLinkFlow =
    path.includes('/sign-in/magic-link') ||
    path.includes('/sign-up/magic-link') ||
    path.includes('/magic-link')

  const limit = isMagicLinkFlow ? 5 : 20
  const windowMs = 60_000
  const result = rateLimit(`auth:${ip}:${isMagicLinkFlow ? 'magic-link' : 'post'}`, limit, windowMs)
  if (result.success) return null
  return rateLimitResponse(result, limit)
}

export async function GET(request: NextRequest): Promise<Response> {
  return handlers.GET(request)
}

export async function POST(request: NextRequest): Promise<Response> {
  const limited = authPostRateLimit(request)
  if (limited) return limited
  return handlers.POST(request)
}
