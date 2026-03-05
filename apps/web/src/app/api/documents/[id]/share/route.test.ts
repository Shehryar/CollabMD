// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) },
  },
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

const mockEnforceUserMutationRateLimit = vi.fn(() => null)
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
  users: {
    id: 'id',
    email: 'email',
    name: 'name',
  },
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
}))

import { DELETE, GET, PATCH, POST } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/documents/[id]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)
    mockDbResult.get.mockReturnValue(undefined)
    mockReadTuples.mockResolvedValue([])
  })

  describe('POST', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null)

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'POST', {
        email: 'target@example.com',
        role: 'viewer',
      })
      const res = await POST(req, makeParams('doc-1'))

      expect(res.status).toBe(401)
    })

    it('writes share tuple for valid collaborator', async () => {
      mockDbResult.get.mockReturnValueOnce({
        id: 'user-2',
        email: 'target@example.com',
        name: 'Target User',
      })

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'POST', {
        email: 'target@example.com',
        role: 'commenter',
      })
      const res = await POST(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.userId).toBe('user-2')
      expect(body.role).toBe('commenter')

      expect(mockCheckPermission).toHaveBeenCalledWith('user-1', 'can_edit', 'document', 'doc-1')
      expect(mockWriteTuple).toHaveBeenCalledWith('user:user-2', 'commenter', 'document:doc-1')
      expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1', { ip: '127.0.0.1' })
    })
  })

  describe('GET', () => {
    it('lists collaborator tuples with user details', async () => {
      mockReadTuples.mockResolvedValueOnce([
        { user: 'user:user-2', relation: 'editor', object: 'document:doc-1' },
        { user: 'org:org-1', relation: 'org', object: 'document:doc-1' },
        { user: 'user:user-3', relation: 'viewer', object: 'document:doc-1' },
      ])
      mockDbResult.get
        .mockReturnValueOnce({ id: 'user-2', name: 'Alice', email: 'alice@example.com' })
        .mockReturnValueOnce({ id: 'user-3', name: '', email: 'bob@example.com' })

      const req = new NextRequest('http://localhost:3000/api/documents/doc-1/share')
      const res = await GET(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([
        {
          userId: 'user-2',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'editor',
        },
        {
          userId: 'user-3',
          name: '',
          email: 'bob@example.com',
          role: 'viewer',
        },
      ])
    })
  })

  describe('PATCH', () => {
    it('updates collaborator role when requester can edit and target is not owner', async () => {
      mockCheckPermission
        .mockResolvedValueOnce(true) // can_edit (request user)
        .mockResolvedValueOnce(false) // owner (target user)

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'PATCH', {
        userId: 'user-2',
        oldRole: 'viewer',
        newRole: 'editor',
      })
      const res = await PATCH(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      expect(mockDeleteTuple).toHaveBeenCalledWith('user:user-2', 'viewer', 'document:doc-1')
      expect(mockWriteTuple).toHaveBeenCalledWith('user:user-2', 'editor', 'document:doc-1')
    })

    it('rejects role changes for the owner', async () => {
      mockCheckPermission
        .mockResolvedValueOnce(true) // can_edit
        .mockResolvedValueOnce(true) // owner

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'PATCH', {
        userId: 'user-2',
        oldRole: 'editor',
        newRole: 'viewer',
      })
      const res = await PATCH(req, makeParams('doc-1'))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('cannot change owner role')
      expect(mockDeleteTuple).not.toHaveBeenCalled()
      expect(mockWriteTuple).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('removes collaborator tuple for valid role', async () => {
      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'DELETE', {
        userId: 'user-2',
        role: 'commenter',
      })
      const res = await DELETE(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(mockDeleteTuple).toHaveBeenCalledWith('user:user-2', 'commenter', 'document:doc-1')
    })
  })
})
