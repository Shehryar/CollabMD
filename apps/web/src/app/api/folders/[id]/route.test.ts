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
const mockReadTuples = vi.fn()
const mockDeleteTuple = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
  readTuplesForEntity: (...args: unknown[]) => mockReadTuples(...args),
  deleteTuple: (...args: unknown[]) => mockDeleteTuple(...args),
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

import { PATCH, DELETE } from './route'

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

describe('PATCH /api/folders/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-1', {
      name: 'New Name',
    })
    const res = await PATCH(req, makeParams('folder-1'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns 403 when user lacks edit permission', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-1', {
      name: 'New Name',
    })
    const res = await PATCH(req, makeParams('folder-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')

    expect(mockCheckPermission).toHaveBeenCalledWith(
      'user-1',
      'can_edit',
      'folder',
      'folder-1',
    )
  })

  it('returns 400 when name is missing', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-1', {})
    const res = await PATCH(req, makeParams('folder-1'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  it('returns 404 when folder is not found', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)
    mockDbResult.get.mockReturnValueOnce(undefined)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-missing', {
      name: 'New Name',
    })
    const res = await PATCH(req, makeParams('folder-missing'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not found')
  })

  it('renames folder and updates path (root folder)', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-1',
      name: 'Old Name',
      path: '/Old Name',
      parentId: null,
      orgId: 'org-1',
    }
    // First get: existing folder lookup
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    const updatedFolder = {
      id: 'folder-1',
      name: 'Renamed',
      path: '/Renamed',
      parentId: null,
      orgId: 'org-1',
    }
    // Second get: update returning
    mockDbResult.get.mockReturnValueOnce(updatedFolder)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-1', {
      name: 'Renamed',
    })
    const res = await PATCH(req, makeParams('folder-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed')
    expect(body.path).toBe('/Renamed')
  })

  it('renames subfolder and recalculates path from parent', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    const existingFolder = {
      id: 'folder-child',
      name: 'Old Child',
      path: '/Parent/Old Child',
      parentId: 'folder-parent',
      orgId: 'org-1',
    }
    // First get: existing folder lookup
    mockDbResult.get.mockReturnValueOnce(existingFolder)

    const parentFolder = {
      id: 'folder-parent',
      name: 'Parent',
      path: '/Parent',
      parentId: null,
      orgId: 'org-1',
    }
    // Second get: parent folder lookup
    mockDbResult.get.mockReturnValueOnce(parentFolder)

    const updatedFolder = {
      id: 'folder-child',
      name: 'New Child',
      path: '/Parent/New Child',
      parentId: 'folder-parent',
      orgId: 'org-1',
    }
    // Third get: update returning
    mockDbResult.get.mockReturnValueOnce(updatedFolder)

    const req = jsonRequest('http://localhost:3000/api/folders/folder-child', {
      name: 'New Child',
    })
    const res = await PATCH(req, makeParams('folder-child'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('New Child')
    expect(body.path).toBe('/Parent/New Child')
  })
})

describe('DELETE /api/folders/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/folders/folder-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('folder-1'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns 403 when user is not the owner', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = new NextRequest('http://localhost:3000/api/folders/folder-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('folder-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')

    expect(mockCheckPermission).toHaveBeenCalledWith(
      'user-1',
      'owner',
      'folder',
      'folder-1',
    )
  })

  it('returns 409 when folder has child documents', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    // First get: child document check — folder has a doc
    mockDbResult.get.mockReturnValueOnce({ id: 'doc-1', folderId: 'folder-1' })

    const req = new NextRequest('http://localhost:3000/api/folders/folder-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('folder-1'))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('folder not empty')
  })

  it('returns 409 when folder has child subfolders', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    // First get: child document check — no docs
    mockDbResult.get.mockReturnValueOnce(undefined)
    // Second get: child folder check — has a subfolder
    mockDbResult.get.mockReturnValueOnce({ id: 'folder-sub', parentId: 'folder-1' })

    const req = new NextRequest('http://localhost:3000/api/folders/folder-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('folder-1'))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('folder not empty')
  })

  it('deletes empty folder and cleans up FGA tuples', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockCheckPermission.mockResolvedValueOnce(true)

    // First get: child document check — no docs
    mockDbResult.get.mockReturnValueOnce(undefined)
    // Second get: child folder check — no subfolders
    mockDbResult.get.mockReturnValueOnce(undefined)

    // db.delete().where().run()
    mockDbResult.run.mockReturnValueOnce(undefined)

    // FGA tuples to clean up
    mockReadTuples.mockResolvedValueOnce([
      { user: 'user:user-1', relation: 'owner', object: 'folder:folder-1' },
      { user: 'org:org-1', relation: 'org', object: 'folder:folder-1' },
    ])
    mockDeleteTuple.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost:3000/api/folders/folder-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('folder-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Verify db.delete was called
    const { db } = await import('@collabmd/db')
    expect(db.delete).toHaveBeenCalled()

    // Verify FGA cleanup
    expect(mockReadTuples).toHaveBeenCalledWith('folder:folder-1')
    expect(mockDeleteTuple).toHaveBeenCalledTimes(2)
    expect(mockDeleteTuple).toHaveBeenCalledWith(
      'user:user-1',
      'owner',
      'folder:folder-1',
    )
    expect(mockDeleteTuple).toHaveBeenCalledWith(
      'org:org-1',
      'org',
      'folder:folder-1',
    )
  })
})
