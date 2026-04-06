// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockConsumeCliAuthCode = vi.fn()
const mockRequireJsonContentType = vi.fn(() => null)

vi.mock('@/lib/cli-auth', () => ({
  consumeCliAuthCode: (...args: unknown[]) => mockConsumeCliAuthCode.apply(undefined, args as never),
}))

vi.mock('@/lib/http', () => ({
  requireJsonContentType: (...args: unknown[]) =>
    mockRequireJsonContentType.apply(undefined, args as never),
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireJsonContentType.mockReturnValue(null)
})

describe('POST /api/auth/cli-exchange', () => {
  it('rejects non-json requests', async () => {
    mockRequireJsonContentType.mockReturnValueOnce(
      new Response(JSON.stringify({ error: 'content-type must be application/json' }), {
        status: 415,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const req = new NextRequest('http://localhost:3000/api/auth/cli-exchange', {
      method: 'POST',
      body: 'code=abc',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const res = await POST(req)
    expect(res.status).toBe(415)
  })

  it('rejects missing code', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/cli-exchange', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects invalid codes', async () => {
    mockConsumeCliAuthCode.mockReturnValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/auth/cli-exchange', {
      method: 'POST',
      body: JSON.stringify({ code: 'bad' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns exchanged credentials for valid one-time code', async () => {
    mockConsumeCliAuthCode.mockReturnValueOnce({
      code: 'good',
      sessionToken: 'session-token',
      userId: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      expiresAt: Date.now() + 60_000,
    })

    const req = new NextRequest('http://localhost:3000/api/auth/cli-exchange', {
      method: 'POST',
      body: JSON.stringify({ code: 'good' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      token: 'session-token',
      userId: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
    })
  })
})
