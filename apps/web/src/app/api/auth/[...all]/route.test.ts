// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const {
  mockGet,
  mockPost,
  mockRateLimit,
  mockRateLimitResponse,
  mockGetClientIp,
} = vi.hoisted(() => ({
  mockGet: vi.fn(async () => new Response('ok')),
  mockPost: vi.fn(async () => new Response('ok')),
  mockRateLimit: vi.fn(),
  mockRateLimitResponse: vi.fn(),
  mockGetClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/auth', () => ({ auth: {} }))
vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({ GET: mockGet, POST: mockPost }),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit.apply(undefined, args as never),
  rateLimitResponse: (...args: unknown[]) =>
    mockRateLimitResponse.apply(undefined, args as never),
  getClientIp: (...args: unknown[]) => mockGetClientIp.apply(undefined, args as never),
}))

import { GET, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mockRateLimit.mockReturnValue({ success: true, remaining: 4, reset: Date.now() + 60_000 })
  mockRateLimitResponse.mockImplementation(() =>
    NextResponse.json({ error: 'too many requests' }, { status: 429 }),
  )
})

describe('/api/auth/[...all]', () => {
  it('passes GET requests through to Better Auth handler', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/get-session')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockGet).toHaveBeenCalledOnce()
  })

  it('rate limits magic-link POST requests more strictly', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/sign-in/magic-link', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRateLimit).toHaveBeenCalledWith('auth:127.0.0.1:magic-link', 5, 60_000)
    expect(mockPost).toHaveBeenCalledOnce()
  })

  it('rate limits generic auth POST requests', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/sign-out', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRateLimit).toHaveBeenCalledWith('auth:127.0.0.1:post', 20, 60_000)
  })

  it('returns 429 when auth POST rate limit is exceeded', async () => {
    mockRateLimit.mockReturnValueOnce({ success: false, remaining: 0, reset: Date.now() + 60_000 })
    const req = new NextRequest('http://localhost:3000/api/auth/sign-in/magic-link', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(429)
    expect(mockPost).not.toHaveBeenCalled()
  })
})
