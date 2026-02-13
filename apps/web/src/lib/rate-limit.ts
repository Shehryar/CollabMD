import { NextRequest, NextResponse } from 'next/server'

interface RateLimitEntry {
  tokens: number
  lastRefill: number
}

const store = new Map<string, RateLimitEntry>()
const MAX_ENTRIES = 10_000

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    // Remove entries that haven't been touched in 5 minutes
    if (now - entry.lastRefill > 5 * 60_000) {
      store.delete(key)
    }
  }
}, 60_000).unref()

/**
 * Token bucket rate limiter (in-memory, per-process).
 *
 * NOTE: In-memory store won't persist across serverless invocations or
 * multiple instances. Fine for MVP; swap to Redis for production.
 */
export function rateLimit(
  key: string,
  maxTokens: number,
  windowMs: number,
): { success: boolean; remaining: number; reset: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry) {
    if (store.size >= MAX_ENTRIES) {
      const oldestKey = store.keys().next().value
      if (oldestKey) store.delete(oldestKey)
    }
    store.set(key, { tokens: maxTokens - 1, lastRefill: now })
    return { success: true, remaining: maxTokens - 1, reset: now + windowMs }
  }

  // Refill tokens based on time elapsed
  const elapsed = now - entry.lastRefill
  const refillAmount = Math.floor(elapsed / windowMs) * maxTokens
  entry.tokens = Math.min(maxTokens, entry.tokens + refillAmount)
  if (refillAmount > 0) entry.lastRefill = now

  if (entry.tokens <= 0) {
    return { success: false, remaining: 0, reset: entry.lastRefill + windowMs }
  }

  entry.tokens--
  return { success: true, remaining: entry.tokens, reset: entry.lastRefill + windowMs }
}

/**
 * Build a 429 JSON response with standard rate-limit headers.
 */
export function rateLimitResponse(
  result: { remaining: number; reset: number },
  limit: number,
): NextResponse {
  return NextResponse.json(
    { error: 'too many requests' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
        'Retry-After': String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))),
      },
    },
  )
}

export function getClientIp(request: Pick<NextRequest, 'headers'>): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export function enforceUserMutationRateLimit(
  userId: string,
  options?: {
    ip?: string
    limit?: number
    windowMs?: number
  },
): NextResponse | null {
  const limit = options?.limit ?? 30
  const windowMs = options?.windowMs ?? 60_000
  const scope = options?.ip ? `user:${userId}:ip:${options.ip}` : `user:${userId}`
  const result = rateLimit(`${scope}:mutation`, limit, windowMs)
  if (result.success) return null
  return rateLimitResponse(result, limit)
}

export function enforceReadRateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000,
): NextResponse | null {
  const result = rateLimit(`${key}:read`, limit, windowMs)
  if (result.success) return null
  return rateLimitResponse(result, limit)
}
