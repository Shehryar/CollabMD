// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockAuthenticateAgentKey = vi.fn()
vi.mock('@/lib/agent-key-auth', () => ({
  authenticateAgentKey: (...args: unknown[]) =>
    mockAuthenticateAgentKey.apply(undefined, args as never),
}))

const mockRateLimit = vi.fn(() => ({
  success: true,
  limit: 100,
  remaining: 99,
  reset: Date.now() + 60_000,
}))
const mockRateLimitResponse = vi.fn(() =>
  NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }),
)
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit.apply(undefined, args as never),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse.apply(undefined, args as never),
}))

const mockAll = vi.fn()
const mockOffset = vi.fn(() => ({ all: mockAll }))
const mockLimit = vi.fn(() => ({ offset: mockOffset }))
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))
const mockSelect = vi.fn(() => ({ from: mockFrom }))

const mockEq = vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] }))
const mockIsNull = vi.fn((value: unknown) => ({ isNull: value }))
const mockInArray = vi.fn((column: unknown, values: unknown[]) => ({ inArray: [column, values] }))
const mockAnd = vi.fn((...conditions: unknown[]) => ({ and: conditions }))
const mockDesc = vi.fn((value: unknown) => value)

vi.mock('@collabmd/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect.apply(undefined, args as never),
  },
  documents: {
    id: 'id',
    title: 'title',
    orgId: 'org_id',
    folderId: 'folder_id',
    deletedAt: 'deleted_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
  isNull: (...args: unknown[]) => mockIsNull.apply(undefined, args as never),
  inArray: (...args: unknown[]) => mockInArray.apply(undefined, args as never),
  and: (...args: unknown[]) => mockAnd.apply(undefined, args as never),
  desc: (...args: unknown[]) => mockDesc.apply(undefined, args as never),
}))

import { GET } from './route'

describe('/api/v1/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateAgentKey.mockResolvedValue({
      context: {
        keyId: 'key-1',
        orgId: 'org-1',
        scopes: {},
      },
    })
    mockRateLimit.mockReturnValue({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60_000,
    })
    mockAll.mockReturnValue([
      {
        id: 'doc-1',
        title: 'First document',
        folderId: 'folder-1',
        createdAt: new Date('2026-02-17T00:00:00.000Z'),
        updatedAt: new Date('2026-02-17T01:00:00.000Z'),
      },
    ])
  })

  it('lists documents for the authenticated key org', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/documents')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        id: 'doc-1',
        title: 'First document',
        folderId: 'folder-1',
        createdAt: '2026-02-17T00:00:00.000Z',
        updatedAt: '2026-02-17T01:00:00.000Z',
      },
    ])
    expect(mockEq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(mockIsNull).toHaveBeenCalledWith('deleted_at')
    expect(mockLimit).toHaveBeenCalledWith(50)
    expect(mockOffset).toHaveBeenCalledWith(0)
    expect(res.headers.get('x-collabmd-next-offset')).toBe('')
  })

  it('applies document and folder scope filters when provided', async () => {
    mockAuthenticateAgentKey.mockResolvedValueOnce({
      context: {
        keyId: 'key-1',
        orgId: 'org-1',
        scopes: {
          documents: ['doc-2', 'doc-3'],
          folders: ['folder-2'],
        },
      },
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents')
    const res = await GET(req)
    expect(res.status).toBe(200)

    expect(mockInArray).toHaveBeenCalledWith('id', ['doc-2', 'doc-3'])
    expect(mockInArray).toHaveBeenCalledWith('folder_id', ['folder-2'])
  })

  it('returns no documents when scopes are explicitly empty arrays', async () => {
    mockAuthenticateAgentKey.mockResolvedValueOnce({
      context: {
        keyId: 'key-1',
        orgId: 'org-1',
        scopes: {
          documents: [],
        },
      },
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('supports limit and offset pagination parameters', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/documents?limit=20&offset=40')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockLimit).toHaveBeenCalledWith(20)
    expect(mockOffset).toHaveBeenCalledWith(40)
  })

  it('returns auth errors from authenticateAgentKey', async () => {
    mockAuthenticateAgentKey.mockResolvedValueOnce({
      error: NextResponse.json({ error: 'invalid api key' }, { status: 401 }),
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents')
    const res = await GET(req)

    expect(res.status).toBe(401)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    mockRateLimit.mockReturnValueOnce({
      success: false,
      limit: 100,
      remaining: 0,
      reset: Date.now() + 1000,
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents')
    const res = await GET(req)

    expect(res.status).toBe(429)
    expect(mockSelect).not.toHaveBeenCalled()
  })
})
