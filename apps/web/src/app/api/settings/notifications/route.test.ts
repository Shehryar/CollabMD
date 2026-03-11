// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) },
  },
}))

const mockEnforceUserMutationRateLimit = vi.fn<(...args: unknown[]) => NextResponse | null>(
  () => null,
)
const mockGetClientIp = vi.fn(() => '127.0.0.1')
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) =>
    mockEnforceUserMutationRateLimit.apply(undefined, args as never),
  getClientIp: (...args: unknown[]) => mockGetClientIp.apply(undefined, args as never),
}))

const mockRequireJsonContentType = vi.fn(() => null)
vi.mock('@/lib/http', () => ({
  requireJsonContentType: (...args: unknown[]) =>
    mockRequireJsonContentType.apply(undefined, args as never),
}))

const mockGetPreference = vi.fn()
const mockSetPreference = vi.fn()
vi.mock('@collabmd/db', () => ({
  getUserEmailNotificationPreference: (...args: unknown[]) =>
    mockGetPreference.apply(undefined, args as never),
  setUserEmailNotificationPreference: (...args: unknown[]) =>
    mockSetPreference.apply(undefined, args as never),
}))

import { GET, PATCH } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

describe('/api/settings/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockGetPreference.mockReturnValue('all')
    mockSetPreference.mockReturnValue('mentions')
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)
  })

  it('returns 401 for unauthenticated GET requests', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const res = await GET(new NextRequest('http://localhost:3000/api/settings/notifications'))

    expect(res.status).toBe(401)
  })

  it('returns the current user notification preference', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/settings/notifications'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ emailNotifications: 'all' })
    expect(mockGetPreference).toHaveBeenCalledWith('user-1')
  })

  it('updates the current user notification preference', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailNotifications: 'mentions' }),
    })

    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ emailNotifications: 'mentions' })
    expect(mockSetPreference).toHaveBeenCalledWith('user-1', 'mentions')
    expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1', { ip: '127.0.0.1' })
  })

  it('rejects invalid preferences', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailNotifications: 'weekly' }),
    })

    const res = await PATCH(req)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid emailNotifications; must be one of: all, mentions, none',
    })
    expect(mockSetPreference).not.toHaveBeenCalled()
  })

  it('returns rate limit errors on PATCH', async () => {
    mockEnforceUserMutationRateLimit.mockReturnValueOnce(
      NextResponse.json({ error: 'too many requests' }, { status: 429 }),
    )

    const req = new NextRequest('http://localhost:3000/api/settings/notifications', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailNotifications: 'none' }),
    })

    const res = await PATCH(req)

    expect(res.status).toBe(429)
    expect(mockSetPreference).not.toHaveBeenCalled()
  })
})
