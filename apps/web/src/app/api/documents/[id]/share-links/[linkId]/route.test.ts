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

const mockRun = vi.fn()
const mockWhereDelete = vi.fn(() => ({ run: mockRun }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
const mockAnd = vi.fn((...args: unknown[]) => ({ and: args }))

vi.mock('@collabmd/db', () => ({
  db: {
    delete: vi.fn(() => ({ where: mockWhereDelete })),
  },
  shareLinks: {
    id: 'id',
    documentId: 'document_id',
  },
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
  and: (...args: unknown[]) => mockAnd.apply(undefined, args as never),
}))

import { DELETE } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(
  id: string,
  linkId: string,
): { params: Promise<{ id: string; linkId: string }> } {
  return { params: Promise.resolve({ id, linkId }) }
}

describe('DELETE /api/documents/[id]/share-links/[linkId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/share-links/link-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1', 'link-1'))

    expect(res.status).toBe(401)
  })

  it('returns 403 when user lacks document edit permission', async () => {
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/share-links/link-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1', 'link-1'))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })

  it('deletes only the targeted share link for the document', async () => {
    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/share-links/link-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, makeParams('doc-1', 'link-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    expect(mockEq).toHaveBeenNthCalledWith(1, 'id', 'link-1')
    expect(mockEq).toHaveBeenNthCalledWith(2, 'document_id', 'doc-1')
    expect(mockAnd).toHaveBeenCalledTimes(1)
    expect(mockWhereDelete).toHaveBeenCalledTimes(1)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })
})
