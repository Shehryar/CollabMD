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

const mockWriteTuple = vi.fn().mockResolvedValue(undefined)
const mockListAccessible = vi.fn()
const mockCheckPermission = vi.fn()
vi.mock('@collabmd/shared', () => ({
  writeTuple: (...args: unknown[]) => mockWriteTuple(...args),
  listAccessibleObjects: (...args: unknown[]) => mockListAccessible(...args),
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}))

// Drizzle chain mock — track calls and return configurable results
const mockDbResult = { get: vi.fn(), all: vi.fn(), run: vi.fn() }
const mockReturning = vi.fn(() => mockDbResult)
const mockValues = vi.fn(() => ({ returning: mockReturning }))
const mockOrderBy = vi.fn(() => mockDbResult)
const mockWhereInner = vi.fn(() => ({
  orderBy: mockOrderBy,
  get: mockDbResult.get,
  all: mockDbResult.all,
}))
const mockFrom = vi.fn(() => ({
  where: mockWhereInner,
}))

vi.mock('@collabmd/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: mockValues })),
    select: vi.fn(() => ({ from: mockFrom })),
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
  members: { organizationId: 'organization_id', userId: 'user_id' },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  asc: vi.fn((a: unknown) => ({ asc: a })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ inArray: [a, b] })),
}))

// ── Import handlers after mocks ────────────────────────────────────────

import { POST, GET } from './route'

// ── Helpers ────────────────────────────────────────────────────────────

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1', activeOrganizationId: 'org-1' },
}

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  method = 'POST',
): NextRequest {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockDbResult.get.mockReturnValue({ organizationId: 'org-1', userId: 'user-1' })
  mockCheckPermission.mockResolvedValue(true)
})

describe('POST /api/folders', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = jsonRequest('http://localhost:3000/api/folders', {
      name: 'Test Folder',
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns 400 when name is missing', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const req = jsonRequest('http://localhost:3000/api/folders', {
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  it('returns 400 when orgId is missing', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const req = jsonRequest('http://localhost:3000/api/folders', {
      name: 'My Folder',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  it('creates folder and writes FGA owner + org tuples', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // membership lookup
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    const fakeFolder = {
      id: 'folder-1',
      orgId: 'org-1',
      name: 'My Folder',
      path: '/My Folder',
      parentId: null,
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
    }
    mockDbResult.get.mockReturnValueOnce(fakeFolder)

    const req = jsonRequest('http://localhost:3000/api/folders', {
      name: 'My Folder',
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('My Folder')
    expect(body.path).toBe('/My Folder')

    // Should write owner tuple and org tuple
    expect(mockWriteTuple).toHaveBeenCalledWith(
      'user:user-1',
      'owner',
      expect.stringContaining('folder:'),
    )
    expect(mockWriteTuple).toHaveBeenCalledWith(
      'org:org-1',
      'org',
      expect.stringContaining('folder:'),
    )
  })

  it('creates subfolder with parent path', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // membership lookup
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    const parentFolder = {
      id: 'folder-parent',
      orgId: 'org-1',
      name: 'Parent',
      path: '/Parent',
      parentId: null,
    }
    // First get: parent folder lookup
    mockDbResult.get.mockReturnValueOnce(parentFolder)

    const childFolder = {
      id: 'folder-child',
      orgId: 'org-1',
      name: 'Child',
      path: '/Parent/Child',
      parentId: 'folder-parent',
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
    }
    // Second get: insert returning
    mockDbResult.get.mockReturnValueOnce(childFolder)

    const req = jsonRequest('http://localhost:3000/api/folders', {
      name: 'Child',
      orgId: 'org-1',
      parentId: 'folder-parent',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.path).toBe('/Parent/Child')
    expect(body.parentId).toBe('folder-parent')
  })

  it('returns 404 when parentId refers to non-existent folder', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // membership lookup
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    // Parent folder lookup returns nothing
    mockDbResult.get.mockReturnValueOnce(undefined)

    const req = jsonRequest('http://localhost:3000/api/folders', {
      name: 'Orphan',
      orgId: 'org-1',
      parentId: 'folder-nonexistent',
    })
    const res = await POST(req)

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('parent folder not found')
  })
})

describe('GET /api/folders', () => {
  function getRequest(url = 'http://localhost:3000/api/folders'): NextRequest {
    return new NextRequest(url, { method: 'GET' })
  }

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const res = await GET(getRequest())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns 400 when orgId is missing', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const res = await GET(getRequest())

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  it('returns empty array when user has no accessible folders', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce([])

    const res = await GET(getRequest('http://localhost:3000/api/folders?orgId=org-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns accessible folders for org', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce([
      'folder:folder-1',
      'folder:folder-2',
    ])

    const fakeFolders = [
      { id: 'folder-1', name: 'Alpha', path: '/Alpha', orgId: 'org-1' },
      { id: 'folder-2', name: 'Beta', path: '/Beta', orgId: 'org-1' },
    ]
    mockDbResult.all.mockReturnValueOnce(fakeFolders)

    const res = await GET(getRequest('http://localhost:3000/api/folders?orgId=org-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].id).toBe('folder-1')
    expect(body[1].id).toBe('folder-2')

    // Verify listAccessibleObjects was called with correct args
    expect(mockListAccessible).toHaveBeenCalledWith('user-1', 'can_view', 'folder')
  })
})
