// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

const mockCheckPermission = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}))

const mockEnforceUserMutationRateLimit = vi.fn(() => null)
const mockGetClientIp = vi.fn(() => '127.0.0.1')
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) => mockEnforceUserMutationRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}))

const mockRequireJsonContentType = vi.fn(() => null)
vi.mock('@/lib/http', () => ({
  requireJsonContentType: (...args: unknown[]) => mockRequireJsonContentType(...args),
}))

const mockInsertRun = vi.fn()
const mockInsertValues = vi.fn(() => ({ run: mockInsertRun }))
const mockSelectAll = vi.fn()
const mockWhereSelect = vi.fn(() => ({
  all: mockSelectAll,
}))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))

vi.mock('@collabmd/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: mockInsertValues })),
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
  eq: (...args: unknown[]) => mockEq(...args),
}))

import { GET, POST } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(url: string, method: 'POST', body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/documents/[id]/share-links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)
    mockSelectAll.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('POST', () => {
    it('returns 400 for invalid permission', async () => {
      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share-links', 'POST', {
        permission: 'owner',
      })

      const res = await POST(req, makeParams('doc-1'))
      expect(res.status).toBe(400)
      expect(mockInsertValues).not.toHaveBeenCalled()
    })

    it('creates share link with hashed password and expiry', async () => {
      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share-links', 'POST', {
        permission: 'editor',
        password: 'secret123',
        expiresInDays: 2,
      })

      const res = await POST(req, makeParams('doc-1'))
      expect(res.status).toBe(201)

      const inserted = mockInsertValues.mock.calls[0][0] as {
        documentId: string
        permission: string
        passwordHash: string | null
        expiresAt: Date | null
        createdBy: string
        createdAt: Date
      }

      expect(inserted.documentId).toBe('doc-1')
      expect(inserted.permission).toBe('editor')
      expect(inserted.createdBy).toBe('user-1')
      expect(inserted.passwordHash).toMatch(/^[a-f0-9]+:[a-f0-9]+$/)
      expect(inserted.passwordHash).not.toContain('secret123')
      expect(inserted.expiresAt?.toISOString()).toBe('2026-01-03T00:00:00.000Z')
      expect(inserted.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    })
  })

  describe('GET', () => {
    it('returns share links with hasPassword and ISO date fields', async () => {
      mockSelectAll.mockReturnValueOnce([
        {
          id: 'link-1',
          token: 'token-1',
          permission: 'viewer',
          passwordHash: 'salt:hash',
          expiresAt: new Date('2026-02-01T00:00:00.000Z'),
          createdBy: 'user-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])

      const req = new NextRequest('http://localhost:3000/api/documents/doc-1/share-links')
      const res = await GET(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([
        {
          id: 'link-1',
          token: 'token-1',
          permission: 'viewer',
          hasPassword: true,
          expiresAt: '2026-02-01T00:00:00.000Z',
          createdBy: 'user-1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ])
    })
  })
})
