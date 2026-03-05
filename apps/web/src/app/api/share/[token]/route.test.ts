// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ──────────────────────────────────────────────────────────────

const mockRateLimit = vi.fn(() => ({
  success: true,
  remaining: 99,
  reset: Date.now() + 60000,
}))
const mockRateLimitResponse = vi.fn(
  (result: { remaining: number; reset: number }, limit: number) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
        },
      },
    )
  },
)

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit.apply(undefined, args as never),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse.apply(undefined, args as never),
}))

// Drizzle chain mock
const mockDbResult = { get: vi.fn(), all: vi.fn(), run: vi.fn() }
const mockWhereSelect = vi.fn(() => ({
  get: mockDbResult.get,
  all: mockDbResult.all,
}))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  shareLinks: {
    id: 'id',
    documentId: 'document_id',
    token: 'token',
    permission: 'permission',
    passwordHash: 'password_hash',
    expiresAt: 'expires_at',
    createdBy: 'created_by',
    createdAt: 'created_at',
  },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}))

// ── Import handler after mocks ─────────────────────────────────────────

import { POST } from './route'

// ── Helpers ────────────────────────────────────────────────────────────

function makeParams(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) }
}

function shareRequest(
  token: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): NextRequest {
  const init: ConstructorParameters<typeof NextRequest>[1] = {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
  }
  if (body) {
    init.body = JSON.stringify(body)
  }
  return new NextRequest(`http://localhost:3000/api/share/${token}`, init)
}

/**
 * Compute SHA-256 hex hash the same way the route handler does,
 * so we can construct matching passwordHash values in test fixtures.
 */
async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/share/[token]', () => {
  it('returns 404 for invalid/unknown token', async () => {
    mockDbResult.get.mockReturnValueOnce(undefined)

    const req = shareRequest('bad-token')
    const res = await POST(req, makeParams('bad-token'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not found')
  })

  it('returns 410 for expired share link', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    mockDbResult.get.mockReturnValueOnce({
      id: 'link-1',
      documentId: 'doc-1',
      token: 'expired-token',
      permission: 'viewer',
      passwordHash: null,
      expiresAt: yesterday,
    })

    const req = shareRequest('expired-token')
    const res = await POST(req, makeParams('expired-token'))

    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toBe('expired')
  })

  it('returns 401 with password_required when link has password and none provided', async () => {
    const hash = await sha256hex('secret123')
    mockDbResult.get.mockReturnValueOnce({
      id: 'link-2',
      documentId: 'doc-2',
      token: 'pw-token',
      permission: 'editor',
      passwordHash: hash,
      expiresAt: null,
    })

    // Send request with no body (will trigger json parse catch -> empty object)
    const req = new NextRequest('http://localhost:3000/api/share/pw-token', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('pw-token'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('password required')
  })

  it('returns 403 for wrong password', async () => {
    const correctHash = await sha256hex('correct-password')
    mockDbResult.get.mockReturnValueOnce({
      id: 'link-3',
      documentId: 'doc-3',
      token: 'pw-token-2',
      permission: 'editor',
      passwordHash: correctHash,
      expiresAt: null,
    })

    const req = shareRequest('pw-token-2', { password: 'wrong-password' })
    const res = await POST(req, makeParams('pw-token-2'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('wrong password')
  })

  it('returns 200 with documentId and permission for valid link (no password)', async () => {
    mockDbResult.get.mockReturnValueOnce({
      id: 'link-4',
      documentId: 'doc-4',
      token: 'valid-token',
      permission: 'viewer',
      passwordHash: null,
      expiresAt: null,
    })

    const req = shareRequest('valid-token')
    const res = await POST(req, makeParams('valid-token'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.documentId).toBe('doc-4')
    expect(body.permission).toBe('viewer')
  })

  it('returns 200 for valid link with correct password', async () => {
    const password = 'my-secret-password'
    const hash = await sha256hex(password)
    mockDbResult.get.mockReturnValueOnce({
      id: 'link-5',
      documentId: 'doc-5',
      token: 'pw-valid-token',
      permission: 'editor',
      passwordHash: hash,
      expiresAt: null,
    })

    const req = shareRequest('pw-valid-token', { password })
    const res = await POST(req, makeParams('pw-valid-token'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.documentId).toBe('doc-5')
    expect(body.permission).toBe('editor')
  })

  it('returns 200 for valid link with future expiry', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    mockDbResult.get.mockReturnValueOnce({
      id: 'link-6',
      documentId: 'doc-6',
      token: 'future-token',
      permission: 'viewer',
      passwordHash: null,
      expiresAt: tomorrow,
    })

    const req = shareRequest('future-token')
    const res = await POST(req, makeParams('future-token'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.documentId).toBe('doc-6')
  })

  it('rate limits by IP address', async () => {
    mockRateLimit.mockReturnValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60000,
    })

    const req = shareRequest('any-token', undefined, {
      'x-forwarded-for': '1.2.3.4',
    })
    const res = await POST(req, makeParams('any-token'))

    expect(res.status).toBe(429)
    expect(mockRateLimit).toHaveBeenCalledWith('ip:1.2.3.4:share', 30, 60_000)
  })
})
