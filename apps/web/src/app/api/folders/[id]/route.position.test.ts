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
const mockReadTuples = vi.fn()
const mockDeleteTuple = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
  readTuplesForEntity: (...args: unknown[]) => mockReadTuples.apply(undefined, args as never),
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
const mockWhereDelete = vi.fn(() => ({
  run: mockDbResult.run,
}))
const mockWhereSelect = vi.fn(() => ({
  get: mockDbResult.get,
  all: mockDbResult.all,
}))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    update: vi.fn(() => ({ set: mockSet })),
    delete: vi.fn(() => ({ where: mockWhereDelete })),
  },
  folders: {
    id: 'id',
    orgId: 'org_id',
    name: 'name',
    path: 'path',
    parentId: 'parent_id',
    position: 'position',
    createdBy: 'created_by',
    createdAt: 'created_at',
  },
  documents: {
    id: 'id',
    folderId: 'folder_id',
  },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  like: vi.fn((a: unknown, b: unknown) => ({ like: [a, b] })),
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
  mockDbResult.all.mockReturnValue([])
  mockReadTuples.mockResolvedValue([])
})

describe('PATCH /api/folders/[id] — position updates', () => {
  it('updates position when provided', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-1',
      name: 'My Folder',
      path: '/My Folder',
      parentId: null,
      position: 0,
      orgId: 'org-1',
    }
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    const updatedFolder = { ...existingFolder, position: 3 }
    mockDbResult.get.mockReturnValueOnce(updatedFolder)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-1', {
      position: 3,
    })
    const res = await PATCH(req, makeParams('folder-1'))

    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ position: 3 }))
  })

  it('accepts position together with name', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-1',
      name: 'Old',
      path: '/Old',
      parentId: null,
      position: 0,
      orgId: 'org-1',
    }
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    const updatedFolder = { ...existingFolder, name: 'New', path: '/New', position: 2 }
    mockDbResult.get.mockReturnValueOnce(updatedFolder)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-1', {
      name: 'New',
      position: 2,
    })
    const res = await PATCH(req, makeParams('folder-1'))

    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', position: 2 }))
  })
})

describe('PATCH /api/folders/[id] — parentId moves', () => {
  it('moves folder to a new parent', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-child',
      name: 'Child',
      path: '/Child',
      parentId: null,
      position: 0,
      orgId: 'org-1',
    }
    // First get: existing folder
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    const targetParent = {
      id: 'folder-parent',
      name: 'Parent',
      path: '/Parent',
      parentId: null,
      position: 0,
      orgId: 'org-1',
    }
    // Second get: target parent lookup (circular check)
    mockDbResult.get.mockReturnValueOnce(targetParent)
    // Third get: ancestor walk — lookup "folder-parent", parentId=null so loop ends
    mockDbResult.get.mockReturnValueOnce(targetParent)
    // Fourth get: recalculate path — parent lookup
    mockDbResult.get.mockReturnValueOnce(targetParent)

    const updatedFolder = {
      id: 'folder-child',
      name: 'Child',
      path: '/Parent/Child',
      parentId: 'folder-parent',
      position: 0,
      orgId: 'org-1',
    }
    // Fifth get: update returning
    mockDbResult.get.mockReturnValueOnce(updatedFolder)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-child', {
      parentId: 'folder-parent',
    })
    const res = await PATCH(req, makeParams('folder-child'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parentId).toBe('folder-parent')
    expect(body.path).toBe('/Parent/Child')
  })

  it('rejects circular reference (moving into itself)', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-1',
      name: 'Folder',
      path: '/Folder',
      parentId: null,
      position: 0,
      orgId: 'org-1',
    }
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-1', {
      parentId: 'folder-1',
    })
    const res = await PATCH(req, makeParams('folder-1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('itself')
  })

  it('rejects circular reference (moving into own descendant)', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-a',
      name: 'A',
      path: '/A',
      parentId: null,
      position: 0,
      orgId: 'org-1',
    }
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    // Target parent is folder-c (a descendant of folder-a)
    const folderC = {
      id: 'folder-c',
      name: 'C',
      path: '/A/B/C',
      parentId: 'folder-b',
      position: 0,
      orgId: 'org-1',
    }
    mockDbResult.get.mockReturnValueOnce(folderC)

    // Ancestor walk: folder-c -> folder-b -> folder-a (hit! circular)
    const folderB = {
      id: 'folder-b',
      name: 'B',
      path: '/A/B',
      parentId: 'folder-a',
      position: 0,
      orgId: 'org-1',
    }
    // Walk step 1: lookup folder-c (parentId = folder-b)
    mockDbResult.get.mockReturnValueOnce(folderC)
    // Walk step 2: lookup folder-b (parentId = folder-a) — matches id, circular!
    mockDbResult.get.mockReturnValueOnce(folderB)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-a', {
      parentId: 'folder-c',
    })
    const res = await PATCH(req, makeParams('folder-a'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('circular')
  })

  it('moves folder to root (parentId: null)', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-child',
      name: 'Child',
      path: '/Parent/Child',
      parentId: 'folder-parent',
      position: 0,
      orgId: 'org-1',
    }
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    const updatedFolder = {
      id: 'folder-child',
      name: 'Child',
      path: '/Child',
      parentId: null,
      position: 0,
      orgId: 'org-1',
    }
    mockDbResult.get.mockReturnValueOnce(updatedFolder)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-child', {
      parentId: null,
    })
    const res = await PATCH(req, makeParams('folder-child'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parentId).toBeNull()
    expect(body.path).toBe('/Child')
  })
})
