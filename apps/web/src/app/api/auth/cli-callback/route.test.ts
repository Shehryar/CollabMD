// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mocks
const mockGetSession = vi.fn()
const mockGetCookie = vi.fn()

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: mockGetCookie,
  })),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

import { GET } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/auth/cli-callback', () => {
  it('returns 400 when port is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?state=abc')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when state is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?port=5000')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid port (too low)', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?port=80&state=abc')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid port (too high)', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?port=99999&state=abc')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-numeric port', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?port=abc&state=xyz')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('redirects to login when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?port=5000&state=abc')
    const res = await GET(req)

    expect(res.status).toBe(307) // NextResponse.redirect uses 307
    const location = res.headers.get('location')!
    expect(location).toContain('/login')
    expect(location).toContain('callbackURL')
    expect(location).toContain('cli-callback')
  })

  it('returns 401 when session exists but no session token cookie', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockGetCookie.mockReturnValueOnce(undefined) // no cookie

    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?port=5000&state=abc')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns auto-post HTML callback when authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockGetCookie.mockReturnValueOnce({ value: 'session_token_value' })

    const req = new NextRequest('http://localhost:3000/api/auth/cli-callback?port=5000&state=abc')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('method="POST"')
    expect(html).toContain('http://127.0.0.1:5000/callback')
    expect(html).toContain('name="token"')
    expect(html).toContain('session_token_value')
    expect(html).not.toContain('token=session_token_value')
  })
})
