// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
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

const mockSelectGet = vi.fn()
const mockWhereSelect = vi.fn(() => ({ get: mockSelectGet }))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockInsertRun = vi.fn()
const mockInsertValues = vi.fn((values: unknown) => ({ run: mockInsertRun }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
const mockAnd = vi.fn((...args: unknown[]) => ({ and: args }))

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
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
  and: (...args: unknown[]) => mockAnd.apply(undefined, args as never),
}))

import { POST } from './route'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1', activeOrganizationId: 'org-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/documents/[id]/revert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-13T12:00:00.000Z'))

    process.env.NEXT_PUBLIC_SYNC_URL = 'ws://localhost:4444'

    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)

    mockSelectGet.mockReturnValue({
      id: 'snap-1',
      snapshot: Buffer.from([9, 8, 7]),
      createdAt: new Date('2026-02-12T09:00:00.000Z'),
    })

    mockFetch.mockResolvedValueOnce(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    )
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('POST reverts document state', async () => {
    const req = jsonRequest('http://localhost:3000/api/documents/doc-1/revert', {
      snapshotId: 'snap-1',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:4444/snapshot/doc-1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:4444/replace/doc-1',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('POST creates backup snapshot before reverting', async () => {
    const req = jsonRequest('http://localhost:3000/api/documents/doc-1/revert', {
      snapshotId: 'snap-1',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    expect(mockInsertValues).toHaveBeenCalledTimes(2)

    const backupInsertCall = mockInsertValues.mock.calls[0]
    expect(backupInsertCall).toBeDefined()
    const backupInsert = backupInsertCall[0] as unknown as {
      snapshot: Buffer
      label: string
    }
    expect(backupInsert.snapshot.equals(Buffer.from([1, 2, 3]))).toBe(true)
    expect(backupInsert.label).toBe('Before revert to 2026-02-12T09:00:00.000Z')

    const backupInsertOrder = mockInsertValues.mock.invocationCallOrder[0]
    const replaceFetchOrder = mockFetch.mock.invocationCallOrder[1]
    expect(backupInsertOrder).toBeLessThan(replaceFetchOrder)
  })

  it('POST creates labeled revert snapshot', async () => {
    const req = jsonRequest('http://localhost:3000/api/documents/doc-1/revert', {
      snapshotId: 'snap-1',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(200)
    const revertInsertCall = mockInsertValues.mock.calls[1]
    expect(revertInsertCall).toBeDefined()
    const revertInsert = revertInsertCall[0] as unknown as {
      snapshot: Buffer
      label: string
    }
    expect(revertInsert.snapshot.equals(Buffer.from([9, 8, 7]))).toBe(true)
    expect(revertInsert.label).toBe('Reverted to 2026-02-12T09:00:00.000Z')
  })

  it('POST requires can_edit permission', async () => {
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1/revert', {
      snapshotId: 'snap-1',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('POST returns 404 for missing snapshot', async () => {
    mockSelectGet.mockReturnValueOnce(undefined)

    const req = jsonRequest('http://localhost:3000/api/documents/doc-1/revert', {
      snapshotId: 'missing',
    })
    const res = await POST(req, makeParams('doc-1'))

    expect(res.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
