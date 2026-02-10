// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

// Drizzle chain mock
const mockDbResult = { get: vi.fn(), all: vi.fn(), run: vi.fn() }
const mockReturning = vi.fn(() => mockDbResult)
const mockWhereUpdate = vi.fn(() => ({
  returning: mockReturning,
}))
const mockSet = vi.fn(() => ({ where: mockWhereUpdate }))
const mockWhereSelect = vi.fn(() => ({
  get: mockDbResult.get,
  all: mockDbResult.all,
}))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    update: vi.fn(() => ({ set: mockSet })),
  },
  documents: {
    id: 'id',
    title: 'title',
    orgId: 'org_id',
    ownerId: 'owner_id',
    folderId: 'folder_id',
    deletedAt: 'deleted_at',
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}))

// ── Import handler after mocks ─────────────────────────────────────────

import { POST } from './route'

// ── Helpers ────────────────────────────────────────────────────────────

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1', activeOrganizationId: 'org-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/documents/[id]/restore', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/restore', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 404 for non-existent document', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce(undefined)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-missing/restore', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('doc-missing'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('returns 403 when user is not the owner', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      title: 'Not Mine',
      ownerId: 'user-other',
      deletedAt: new Date(),
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/restore', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
  })

  it('returns 400 when document is not deleted', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      title: 'Active Doc',
      ownerId: 'user-1',
      deletedAt: null,
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/restore', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('not deleted')
  })

  it('returns 410 when document was deleted more than 30 days ago', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      title: 'Expired Doc',
      ownerId: 'user-1',
      deletedAt: fortyDaysAgo,
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/restore', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toContain('expired')
  })

  it('restores document deleted within 30-day window', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    // First .get() for the select query
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      title: 'Recoverable Doc',
      ownerId: 'user-1',
      deletedAt: fiveDaysAgo,
    })
    // Second .get() for the update...returning().get()
    const restoredDoc = {
      id: 'doc-1',
      title: 'Recoverable Doc',
      ownerId: 'user-1',
      deletedAt: null,
    }
    mockDbResult.get.mockReturnValueOnce(restoredDoc)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/restore', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('doc-1')
    expect(body.deletedAt).toBeNull()
  })

  it('restores document deleted exactly at the 30-day boundary', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // Exactly 29 days, 23 hours ago — should be within the window
    const justInside = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000 - 60_000))
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      title: 'Boundary Doc',
      ownerId: 'user-1',
      deletedAt: justInside,
    })
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-1',
      title: 'Boundary Doc',
      ownerId: 'user-1',
      deletedAt: null,
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/restore', {
      method: 'POST',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
  })
})
