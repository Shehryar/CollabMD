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

const mockCheckPermission = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}))

// Drizzle chain mock
const mockDbResult = { get: vi.fn(), all: vi.fn(), run: vi.fn() }
const mockReturning = vi.fn(() => mockDbResult)
const mockWhereUpdate = vi.fn(() => ({
  returning: mockReturning,
  run: mockDbResult.run,
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
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  isNull: vi.fn((a: unknown) => ({ isNull: a })),
}))

// ── Import handlers after mocks ────────────────────────────────────────

import { GET, PATCH, DELETE } from './route'

// ── Helpers ────────────────────────────────────────────────────────────

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1', activeOrganizationId: 'org-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/documents/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1')
    const res = await GET(req, makeParams('doc-1'))

    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent document', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce(undefined)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-missing')
    const res = await GET(req, makeParams('doc-missing'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('returns document when found', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const fakeDoc = {
      id: 'doc-1',
      title: 'My Document',
      orgId: 'org-1',
      ownerId: 'user-1',
      deletedAt: null,
    }
    mockDbResult.get.mockReturnValueOnce(fakeDoc)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1')
    const res = await GET(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('doc-1')
    expect(body.title).toBe('My Document')
  })
})

describe('PATCH /api/documents/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1', {
      title: 'New Title',
    })
    const res = await PATCH(req, makeParams('doc-1'))

    expect(res.status).toBe(401)
  })

  it('returns 403 when user lacks edit permission', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1', {
      title: 'New Title',
    })
    const res = await PATCH(req, makeParams('doc-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')

    expect(mockCheckPermission).toHaveBeenCalledWith(
      'user-1',
      'can_edit',
      'document',
      'doc-1',
    )
  })

  it('returns 404 when update affects no rows', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)
    mockDbResult.get.mockReturnValueOnce(undefined)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-gone', {
      title: 'New Title',
    })
    const res = await PATCH(req, makeParams('doc-gone'))

    expect(res.status).toBe(404)
  })

  it('updates title when authorized', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const updatedDoc = {
      id: 'doc-1',
      title: 'Updated Title',
      orgId: 'org-1',
      ownerId: 'user-1',
    }
    mockDbResult.get.mockReturnValueOnce(updatedDoc)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1', {
      title: 'Updated Title',
    })
    const res = await PATCH(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('Updated Title')
  })
})

describe('DELETE /api/documents/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not the owner', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')

    expect(mockCheckPermission).toHaveBeenCalledWith(
      'user-1',
      'owner',
      'document',
      'doc-1',
    )
  })

  it('soft deletes document when user is owner', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)
    mockDbResult.run.mockReturnValueOnce(undefined)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Verify db.update was called
    const { db } = await import('@collabmd/db')
    expect(db.update).toHaveBeenCalled()
  })
})
