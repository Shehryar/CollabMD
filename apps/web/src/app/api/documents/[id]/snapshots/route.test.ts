// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) } },
}))

const mockCheckPermission = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
}))

const mockEnforceUserMutationRateLimit = vi.fn(() => null)
const mockGetClientIp = vi.fn(() => '127.0.0.1')
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) => mockEnforceUserMutationRateLimit.apply(undefined, args as never),
  getClientIp: (...args: unknown[]) => mockGetClientIp.apply(undefined, args as never),
}))

const mockRequireJsonContentType = vi.fn(() => null)
vi.mock('@/lib/http', () => ({
  requireJsonContentType: (...args: unknown[]) => mockRequireJsonContentType.apply(undefined, args as never),
}))

vi.mock('@/lib/sync-url', () => ({
  getSyncHttpUrl: () => 'http://localhost:4444',
}))

const mockSelectAll = vi.fn()
const mockLimit = vi.fn(() => ({ all: mockSelectAll }))
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
const mockWhereSelect = vi.fn(() => ({ orderBy: mockOrderBy }))
const mockLeftJoin = vi.fn(() => ({ where: mockWhereSelect }))
const mockFrom = vi.fn(() => ({ leftJoin: mockLeftJoin }))
const mockInsertRun = vi.fn()
const mockInsertValues = vi.fn((values: unknown) => ({ run: mockInsertRun }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
const mockDesc = vi.fn((a: unknown) => ({ desc: a }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
  },
  documentSnapshots: {
    id: 'id',
    documentId: 'document_id',
    snapshot: 'snapshot',
    createdAt: 'created_at',
    createdBy: 'created_by',
    isAgentEdit: 'is_agent_edit',
    label: 'label',
  },
  users: {
    id: 'id',
    name: 'name',
  },
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
  desc: (...args: unknown[]) => mockDesc.apply(undefined, args as never),
}))

import { GET, POST } from './route'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1', activeOrganizationId: 'org-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonPostRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/documents/[id]/snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-10T10:00:00.000Z'))
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)
    mockSelectAll.mockReturnValue([])
    mockFetch.mockResolvedValue(new Response(Uint8Array.from([1, 2, 3]), { status: 200 }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('GET returns snapshots sorted by createdAt desc without blob and with author names', async () => {
    mockSelectAll.mockReturnValueOnce([
      {
        id: 'snap-new',
        createdAt: new Date('2026-02-10T09:00:00.000Z'),
        createdBy: 'user-1',
        createdByName: 'Test User',
        isAgentEdit: false,
        label: 'Before edit',
      },
      {
        id: 'snap-old',
        createdAt: new Date('2026-02-09T09:00:00.000Z'),
        createdBy: null,
        createdByName: null,
        isAgentEdit: true,
        label: null,
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/snapshots')
    const res = await GET(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    expect(mockOrderBy).toHaveBeenCalled()
    const body = await res.json()
    expect(body).toEqual([
      {
        id: 'snap-new',
        createdAt: '2026-02-10T09:00:00.000Z',
        createdBy: 'user-1',
        createdByName: 'Test User',
        isAgentEdit: false,
        label: 'Before edit',
      },
      {
        id: 'snap-old',
        createdAt: '2026-02-09T09:00:00.000Z',
        createdBy: null,
        createdByName: null,
        isAgentEdit: true,
        label: null,
      },
    ])
    expect((body[0] as { snapshot?: string }).snapshot).toBeUndefined()
  })

  it('GET returns 401 for unauthenticated users', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/snapshots')
    const res = await GET(req, makeParams('doc-1'))

    expect(res.status).toBe(401)
  })

  it('GET returns 403 when user lacks can_view', async () => {
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/snapshots')
    const res = await GET(req, makeParams('doc-1'))

    expect(res.status).toBe(403)
    expect(mockSelectAll).not.toHaveBeenCalled()
  })

  it('POST creates a manual snapshot with optional label', async () => {
    const req = jsonPostRequest('http://localhost:3000/api/documents/doc-1/snapshots', {
      label: 'Before refactor',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(201)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4444/snapshot/doc-1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    const insertedCall = mockInsertValues.mock.calls[0]
    expect(insertedCall).toBeDefined()
    const inserted = insertedCall[0] as unknown as {
      documentId: string
      snapshot: Buffer
      createdBy: string
      isAgentEdit: boolean
      label: string | null
    }
    expect(inserted.documentId).toBe('doc-1')
    expect(Array.from(inserted.snapshot.values())).toEqual([1, 2, 3])
    expect(inserted.createdBy).toBe('user-1')
    expect(inserted.isAgentEdit).toBe(false)
    expect(inserted.label).toBe('Before refactor')
  })

  it('POST returns 403 when user lacks can_edit', async () => {
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = jsonPostRequest('http://localhost:3000/api/documents/doc-1/snapshots', {})
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(403)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('POST returns 401 for unauthenticated users', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = jsonPostRequest('http://localhost:3000/api/documents/doc-1/snapshots', {})
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(401)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
