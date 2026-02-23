// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) } },
}))

const mockCheckPermission = vi.fn()
const mockWriteTuple = vi.fn()
const mockDeleteTuple = vi.fn()
const mockReadTuples = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
  writeTuple: (...args: unknown[]) => mockWriteTuple.apply(undefined, args as never),
  deleteTuple: (...args: unknown[]) => mockDeleteTuple.apply(undefined, args as never),
  readTuples: (...args: unknown[]) => mockReadTuples.apply(undefined, args as never),
}))

const mockEnforceUserMutationRateLimit = vi.fn((..._args: unknown[]): NextResponse | null => null)
const mockGetClientIp = vi.fn(() => '127.0.0.1')
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) => mockEnforceUserMutationRateLimit.apply(undefined, args as never),
  getClientIp: (...args: unknown[]) => mockGetClientIp.apply(undefined, args as never),
}))

const mockRequireJsonContentType = vi.fn(() => null)
vi.mock('@/lib/http', () => ({
  requireJsonContentType: (...args: unknown[]) => mockRequireJsonContentType.apply(undefined, args as never),
}))

const mockDbResult = { get: vi.fn(), all: vi.fn() }
const mockWhereSelect = vi.fn(() => ({
  get: mockDbResult.get,
  all: mockDbResult.all,
}))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockInArray = vi.fn((a: unknown, b: unknown) => ({ inArray: [a, b] }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  users: {
    id: 'id',
    name: 'name',
    email: 'email',
  },
  inArray: (...args: unknown[]) => mockInArray.apply(undefined, args as never),
}))

import { DELETE, GET, POST } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(url: string, method: 'POST' | 'DELETE', body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/folders/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)
    mockReadTuples.mockResolvedValue([])
    mockDbResult.all.mockReturnValue([])
  })

  describe('POST', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null)
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'POST', {
        userId: 'user-2',
        role: 'viewer',
      })
      const res = await POST(req, makeParams('folder-1'))
      expect(res.status).toBe(401)
    })

    it('writes tuple for valid collaborator role', async () => {
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'POST', {
        userId: 'user-2',
        role: 'editor',
      })
      const res = await POST(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(mockWriteTuple).toHaveBeenCalledWith('user:user-2', 'editor', 'folder:folder-1')
      expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1')
      expect(mockRequireJsonContentType).toHaveBeenCalledTimes(1)
    })
  })

  describe('GET', () => {
    it('does not invoke mutation-only guards on GET and returns filtered user collaborators', async () => {
      mockReadTuples.mockResolvedValueOnce([
        { user: 'user:user-2', relation: 'owner', object: 'folder:folder-1' },
        { user: 'user:user-3', relation: 'editor', object: 'folder:folder-1' },
        { user: 'user:user-4', relation: 'viewer', object: 'folder:folder-1' },
        { user: 'org:org-1', relation: 'org', object: 'folder:folder-1' },
      ])
      mockDbResult.all.mockReturnValueOnce([
        { id: 'user-2', name: 'Owner User', email: 'owner@example.com' },
        { id: 'user-3', name: 'Editor User', email: 'editor@example.com' },
        { id: 'user-4', name: '', email: 'viewer@example.com' },
      ])

      const req = new NextRequest('http://localhost:3000/api/folders/folder-1/permissions')
      const res = await GET(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        { userId: 'user-2', name: 'Owner User', email: 'owner@example.com', role: 'owner' },
        { userId: 'user-3', name: 'Editor User', email: 'editor@example.com', role: 'editor' },
        { userId: 'user-4', name: '', email: 'viewer@example.com', role: 'viewer' },
      ])
      expect(mockEnforceUserMutationRateLimit).not.toHaveBeenCalled()
      expect(mockRequireJsonContentType).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('adds rate limiting with client IP and deletes tuple for valid role', async () => {
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'DELETE', {
        userId: 'user-2',
        role: 'viewer',
      })
      const res = await DELETE(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1', { ip: '127.0.0.1' })
      expect(mockDeleteTuple).toHaveBeenCalledWith('user:user-2', 'viewer', 'folder:folder-1')
    })

    it('returns 400 for invalid delete role', async () => {
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'DELETE', {
        userId: 'user-2',
        role: 'owner',
      })
      const res = await DELETE(req, makeParams('folder-1'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'role must be viewer or editor' })
      expect(mockDeleteTuple).not.toHaveBeenCalled()
    })

    it('returns rate limit response when limiter blocks request', async () => {
      mockEnforceUserMutationRateLimit.mockReturnValueOnce(
        NextResponse.json({ error: 'too many requests' }, { status: 429 }),
      )

      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'DELETE', {
        userId: 'user-2',
        role: 'editor',
      })
      const res = await DELETE(req, makeParams('folder-1'))

      expect(res.status).toBe(429)
      expect(mockDeleteTuple).not.toHaveBeenCalled()
    })
  })
})
