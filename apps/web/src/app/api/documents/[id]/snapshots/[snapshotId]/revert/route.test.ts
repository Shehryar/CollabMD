// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/lib/sync-url', () => ({
  getSyncHttpUrl: () => 'http://localhost:4444',
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

function makeParams(
  id: string,
  snapshotId: string,
): { params: Promise<{ id: string; snapshotId: string }> } {
  return { params: Promise.resolve({ id, snapshotId }) }
}

describe('/api/documents/[id]/snapshots/[snapshotId]/revert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockSelectGet.mockReturnValue({
      id: 'snap-1',
      snapshot: Buffer.from([9, 8, 7]),
      createdAt: new Date('2026-02-12T09:00:00.000Z'),
    })
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })

  it('POST reverts document and creates "Reverted to..." snapshot', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/documents/doc-1/snapshots/snap-1/revert',
      {
        method: 'POST',
      },
    )
    const res = await POST(req, makeParams('doc-1', 'snap-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4444/replace/doc-1',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    const insertedCall = mockInsertValues.mock.calls[0]
    expect(insertedCall).toBeDefined()
    const inserted = insertedCall[0] as unknown as {
      label: string
      createdBy: string
      documentId: string
    }
    expect(inserted.documentId).toBe('doc-1')
    expect(inserted.createdBy).toBe('user-1')
    expect(inserted.label).toBe('Reverted to 2026-02-12T09:00:00.000Z')
  })

  it('POST returns 403 when user lacks can_edit', async () => {
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = new NextRequest(
      'http://localhost:3000/api/documents/doc-1/snapshots/snap-1/revert',
      {
        method: 'POST',
      },
    )
    const res = await POST(req, makeParams('doc-1', 'snap-1'))

    expect(res.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('POST returns 404 for nonexistent snapshot', async () => {
    mockSelectGet.mockReturnValueOnce(undefined)

    const req = new NextRequest(
      'http://localhost:3000/api/documents/doc-1/snapshots/missing/revert',
      {
        method: 'POST',
      },
    )
    const res = await POST(req, makeParams('doc-1', 'missing'))

    expect(res.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
