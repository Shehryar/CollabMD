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

const mockHardDeleteDocument = vi.fn()
vi.mock('@/lib/hard-delete', () => ({
  hardDeleteDocument: (...args: unknown[]) =>
    mockHardDeleteDocument.apply(undefined, args as never),
}))

const mockEnforceUserMutationRateLimit = vi.fn((..._args: unknown[]): NextResponse | null => null)
const mockGetClientIp = vi.fn(() => '127.0.0.1')
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) =>
    mockEnforceUserMutationRateLimit.apply(undefined, args as never),
  getClientIp: (...args: unknown[]) => mockGetClientIp.apply(undefined, args as never),
}))

const mockDbResult = { get: vi.fn() }
const mockWhereSelect = vi.fn(() => ({
  get: mockDbResult.get,
}))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  documents: {
    id: 'id',
  },
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
}))

import { DELETE } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

describe('DELETE /api/documents/[id]/permanent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockHardDeleteDocument.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/permanent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 404 when document does not exist', async () => {
    mockDbResult.get.mockReturnValueOnce(undefined)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/permanent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
    expect(mockHardDeleteDocument).not.toHaveBeenCalled()
  })

  it('returns 403 when user is not owner', async () => {
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      ownerId: 'other-user',
      deletedAt: new Date('2026-02-01T00:00:00.000Z'),
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/permanent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(mockHardDeleteDocument).not.toHaveBeenCalled()
  })

  it('returns 409 when document is not in trash', async () => {
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      ownerId: 'user-1',
      deletedAt: null,
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/permanent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'document must be in trash before permanent deletion',
    })
    expect(mockHardDeleteDocument).not.toHaveBeenCalled()
  })

  it('hard deletes document when owner and trashed', async () => {
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      ownerId: 'user-1',
      deletedAt: new Date('2026-02-01T00:00:00.000Z'),
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/permanent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockHardDeleteDocument).toHaveBeenCalledWith('doc-1')
    expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1', { ip: '127.0.0.1' })
  })

  it('returns rate limit response when limiter blocks request', async () => {
    mockEnforceUserMutationRateLimit.mockReturnValueOnce(
      NextResponse.json({ error: 'too many requests' }, { status: 429 }),
    )

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/permanent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(429)
    expect(mockHardDeleteDocument).not.toHaveBeenCalled()
  })
})
