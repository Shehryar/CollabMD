// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ──────────────────────────────────────────────────────────────

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
const mockReadTuples = vi.fn()
const mockDeleteTuple = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
  writeTuple: (...args: unknown[]) => mockWriteTuple.apply(undefined, args as never),
  readTuples: (...args: unknown[]) => mockReadTuples.apply(undefined, args as never),
  deleteTuple: (...args: unknown[]) => mockDeleteTuple.apply(undefined, args as never),
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
    position: 'position',
    deletedAt: 'deleted_at',
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  },
  folders: {
    id: 'id',
    orgId: 'org_id',
  },
  organizations: {
    id: 'id',
    metadata: 'metadata',
  },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  isNull: vi.fn((a: unknown) => ({ isNull: a })),
}))

// ── Import handlers after mocks ────────────────────────────────────────

import { PATCH } from './route'

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
  mockCheckPermission.mockResolvedValue(true)
  mockReadTuples.mockResolvedValue([])
  mockDbResult.get.mockReturnValue({
    id: 'doc-1',
    title: 'My Document',
    orgId: 'org-1',
    ownerId: 'user-1',
    folderId: null,
    position: 0,
    deletedAt: null,
  })
})

describe('PATCH /api/documents/[id] — position updates', () => {
  it('updates position when provided', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const updatedDoc = {
      id: 'doc-1',
      title: 'My Document',
      orgId: 'org-1',
      ownerId: 'user-1',
      folderId: null,
      position: 5,
    }
    mockDbResult.get.mockReturnValue(updatedDoc)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1', {
      position: 5,
    })
    const res = await PATCH(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ position: 5 }))
  })

  it('updates position together with title', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const updatedDoc = {
      id: 'doc-1',
      title: 'New Title',
      orgId: 'org-1',
      ownerId: 'user-1',
      folderId: null,
      position: 2,
    }
    mockDbResult.get.mockReturnValue(updatedDoc)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1', {
      title: 'New Title',
      position: 2,
    })
    const res = await PATCH(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New Title', position: 2 }),
    )
  })

  it('does not touch FGA when only position is updated', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const updatedDoc = {
      id: 'doc-1',
      title: 'My Document',
      orgId: 'org-1',
      ownerId: 'user-1',
      folderId: null,
      position: 3,
    }
    mockDbResult.get.mockReturnValue(updatedDoc)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1', {
      position: 3,
    })
    const res = await PATCH(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    expect(mockReadTuples).not.toHaveBeenCalled()
    expect(mockWriteTuple).not.toHaveBeenCalled()
  })
})
