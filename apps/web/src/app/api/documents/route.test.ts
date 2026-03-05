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

const mockWriteTuple = vi.fn().mockResolvedValue(undefined)
const mockListAccessible = vi.fn()
const mockCheckPermission = vi.fn()
vi.mock('@collabmd/shared', () => ({
  writeTuple: (...args: unknown[]) => mockWriteTuple.apply(undefined, args as never),
  listAccessibleObjects: (...args: unknown[]) => mockListAccessible.apply(undefined, args as never),
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ success: true, remaining: 99, reset: Date.now() + 60000 })),
  rateLimitResponse: vi.fn(),
  enforceUserMutationRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// Drizzle chain mock — track calls and return configurable results
const mockDbResult = { get: vi.fn(), all: vi.fn(), run: vi.fn() }
const mockReturning = vi.fn(() => mockDbResult)
const mockValues = vi.fn(() => ({ returning: mockReturning }))
const mockOrderBy = vi.fn(() => mockDbResult)
const mockDeleteRun = vi.fn()
const mockDeleteWhere = vi.fn(() => ({ run: mockDeleteRun }))
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }))
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
    delete: (...args: unknown[]) => mockDelete.apply(undefined, args as never),
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
    isPublic: 'is_public',
  },
  organizations: { id: 'org_id', metadata: 'metadata' },
  members: { organizationId: 'organization_id', userId: 'user_id' },
  folders: { id: 'id', orgId: 'org_id' },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  isNull: vi.fn((a: unknown) => ({ isNull: a })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ inArray: [a, b] })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
  like: vi.fn((a: unknown, b: unknown) => ({ like: [a, b] })),
  ne: vi.fn((a: unknown, b: unknown) => ({ ne: [a, b] })),
}))

const mockIndexDocument = vi.fn()
const mockSearchDocuments = vi.fn()
vi.mock('@/lib/search-index', () => ({
  indexDocument: (...args: unknown[]) => mockIndexDocument.apply(undefined, args as never),
  searchDocuments: (...args: unknown[]) => mockSearchDocuments.apply(undefined, args as never),
}))

// ── Import handlers after mocks ────────────────────────────────────────

import { POST, GET } from './route'

// ── Helpers ────────────────────────────────────────────────────────────

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1', activeOrganizationId: 'org-1' },
}

function jsonRequest(url: string, body: Record<string, unknown>, method = 'POST'): NextRequest {
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
  mockDeleteRun.mockReset()
  mockDeleteWhere.mockClear()
  mockDelete.mockClear()
  mockSearchDocuments.mockReturnValue([])
})

describe('POST /api/documents', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = jsonRequest('http://localhost:3000/api/documents', {
      title: 'Test',
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns 400 when title is missing', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const req = jsonRequest('http://localhost:3000/api/documents', {
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  it('returns 400 when orgId is missing', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    const req = jsonRequest('http://localhost:3000/api/documents', {
      title: 'My Doc',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('creates document and writes FGA owner + org tuples', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // membership lookup
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    const fakeDoc = {
      id: 'doc-1',
      title: 'My Doc',
      orgId: 'org-1',
      ownerId: 'user-1',
    }
    mockDbResult.get.mockReturnValueOnce(fakeDoc)
    // org lookup for default permissions
    mockDbResult.get.mockReturnValueOnce(null)

    const req = jsonRequest('http://localhost:3000/api/documents', {
      title: 'My Doc',
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('doc-1')

    // Should write owner tuple and org tuple
    expect(mockWriteTuple).toHaveBeenCalledWith(
      'user:user-1',
      'owner',
      expect.stringContaining('document:'),
    )
    expect(mockWriteTuple).toHaveBeenCalledWith(
      'org:org-1',
      'org',
      expect.stringContaining('document:'),
    )
  })

  it('writes folder parent tuple when folderId is provided', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // membership lookup
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    // folder lookup
    mockDbResult.get.mockReturnValueOnce({ id: 'folder-1', orgId: 'org-1' })
    const fakeDoc = {
      id: 'doc-2',
      title: 'Nested Doc',
      orgId: 'org-1',
      ownerId: 'user-1',
      folderId: 'folder-1',
    }
    mockDbResult.get.mockReturnValueOnce(fakeDoc)
    mockDbResult.get.mockReturnValueOnce(null) // org lookup

    const req = jsonRequest('http://localhost:3000/api/documents', {
      title: 'Nested Doc',
      orgId: 'org-1',
      folderId: 'folder-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockWriteTuple).toHaveBeenCalledWith(
      expect.stringContaining('folder:folder-1'),
      'parent',
      expect.stringContaining('document:'),
    )
  })

  it('applies org default document permissions to other members', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // membership lookup
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    const fakeDoc = {
      id: 'doc-3',
      title: 'Shared Doc',
      orgId: 'org-1',
      ownerId: 'user-1',
    }
    mockDbResult.get.mockReturnValueOnce(fakeDoc)
    // org with default permissions
    mockDbResult.get.mockReturnValueOnce({
      id: 'org-1',
      metadata: JSON.stringify({ defaultDocPermission: 'editor' }),
    })
    // org members
    mockDbResult.all.mockReturnValueOnce([
      { userId: 'user-1', organizationId: 'org-1' },
      { userId: 'user-2', organizationId: 'org-1' },
      { userId: 'user-3', organizationId: 'org-1' },
    ])

    const req = jsonRequest('http://localhost:3000/api/documents', {
      title: 'Shared Doc',
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)

    // Should write editor tuples for user-2 and user-3, but NOT user-1 (the owner)
    const editorCalls = mockWriteTuple.mock.calls.filter((c: unknown[]) => c[1] === 'editor')
    expect(editorCalls).toHaveLength(2)
    expect(editorCalls[0][0]).toBe('user:user-2')
    expect(editorCalls[1][0]).toBe('user:user-3')
  })

  it('skips default permissions when org metadata has defaultDocPermission=none', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)

    // membership lookup
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    const fakeDoc = { id: 'doc-4', title: 'Private', orgId: 'org-1', ownerId: 'user-1' }
    mockDbResult.get.mockReturnValueOnce(fakeDoc)
    mockDbResult.get.mockReturnValueOnce({
      id: 'org-1',
      metadata: JSON.stringify({ defaultDocPermission: 'none' }),
    })

    const req = jsonRequest('http://localhost:3000/api/documents', {
      title: 'Private',
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    // Only owner + org tuples, no additional permission tuples
    expect(mockWriteTuple).toHaveBeenCalledTimes(2)
  })

  it('returns 503 and rolls back document when permission writes fail due to unavailable service', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ organizationId: 'org-1', userId: 'user-1' })
    mockDbResult.get.mockReturnValueOnce({
      id: 'doc-rollback',
      title: 'Rollback',
      orgId: 'org-1',
      ownerId: 'user-1',
    })
    mockWriteTuple.mockRejectedValueOnce(new Error('ECONNREFUSED: openfga'))

    const req = jsonRequest('http://localhost:3000/api/documents', {
      title: 'Rollback',
      orgId: 'org-1',
    })
    const res = await POST(req)

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Permissions service unavailable')
    expect(mockDelete).toHaveBeenCalled()
    expect(mockDeleteWhere).toHaveBeenCalled()
    expect(mockDeleteRun).toHaveBeenCalled()
  })
})

describe('GET /api/documents', () => {
  function getRequest(url = 'http://localhost:3000/api/documents'): NextRequest {
    return new NextRequest(url, { method: 'GET' })
  }

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const res = await GET(getRequest())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns empty array when user has no accessible docs', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce([])

    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns docs matching accessible IDs, excluding soft-deleted', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce(['document:doc-1', 'document:doc-2'])

    const fakeDocs = [
      { id: 'doc-1', title: 'Active Doc', deletedAt: null },
      { id: 'doc-2', title: 'Another Doc', deletedAt: null },
    ]
    mockDbResult.all.mockReturnValueOnce(fakeDocs)

    const res = await GET(getRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].id).toBe('doc-1')

    // Verify listAccessibleObjects was called with correct args
    expect(mockListAccessible).toHaveBeenCalledWith('user-1', 'can_view', 'document')
  })

  it('filters by folderId when ?folderId= is provided', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce(['document:doc-1'])
    mockDbResult.all.mockReturnValueOnce([
      { id: 'doc-1', title: 'Folder Doc', deletedAt: null, folderId: 'folder-1' },
    ])

    const res = await GET(getRequest('http://localhost:3000/api/documents?folderId=folder-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)

    const { eq } = await import('@collabmd/db')
    expect(eq).toHaveBeenCalledWith('folder_id', 'folder-1')
  })

  it('filters shared docs when ?shared=true', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce(['document:doc-1', 'document:doc-2'])
    mockDbResult.all.mockReturnValueOnce([
      { id: 'doc-2', title: 'Shared Doc', deletedAt: null, ownerId: 'user-2' },
    ])

    const res = await GET(getRequest('http://localhost:3000/api/documents?shared=true'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)

    const { ne } = await import('@collabmd/db')
    expect(ne).toHaveBeenCalledWith('owner_id', 'user-1')
  })

  it('uses FTS5 search with snippets when ?search= matches content', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce(['document:doc-1', 'document:doc-2'])
    mockSearchDocuments.mockReturnValueOnce([
      { documentId: 'doc-1', snippet: 'Hello <mark>world</mark> content' },
    ])
    mockDbResult.all.mockReturnValueOnce([{ id: 'doc-1', title: 'test doc', deletedAt: null }])

    const res = await GET(getRequest('http://localhost:3000/api/documents?search=world'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].snippet).toBe('Hello <mark>world</mark> content')

    // FTS should be called with the search query and accessible doc IDs
    expect(mockSearchDocuments).toHaveBeenCalledWith('world', ['doc-1', 'doc-2'])

    // Should use inArray (not like) since FTS returned results
    const { inArray } = await import('@collabmd/db')
    expect(inArray).toHaveBeenCalledWith('id', ['doc-1'])
  })

  it('falls back to title LIKE when FTS5 returns no results', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce(['document:doc-1'])
    mockSearchDocuments.mockReturnValueOnce([])
    mockDbResult.all.mockReturnValueOnce([{ id: 'doc-1', title: 'test doc', deletedAt: null }])

    const res = await GET(getRequest('http://localhost:3000/api/documents?search=test'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].snippet).toBeNull()

    const { like } = await import('@collabmd/db')
    expect(like).toHaveBeenCalledWith('title', '%test%')
  })

  it('combines FTS search with folder filter', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockResolvedValueOnce(['document:doc-1'])
    mockSearchDocuments.mockReturnValueOnce([
      { documentId: 'doc-1', snippet: 'matching <mark>content</mark>' },
    ])
    mockDbResult.all.mockReturnValueOnce([
      { id: 'doc-1', title: 'test doc', deletedAt: null, folderId: 'f1' },
    ])

    const res = await GET(
      getRequest('http://localhost:3000/api/documents?folderId=f1&search=content'),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)

    const { eq } = await import('@collabmd/db')
    expect(eq).toHaveBeenCalledWith('folder_id', 'f1')
  })

  it('returns 503 when permission service is unavailable during list', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockListAccessible.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8081'))

    const res = await GET(getRequest())

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Permissions service unavailable')
  })
})
