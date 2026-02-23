// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) } },
}))

const mockEnforceUserMutationRateLimit = vi.fn(() => null)
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) => mockEnforceUserMutationRateLimit.apply(undefined, args as never),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/http', () => ({
  requireJsonContentType: vi.fn(() => null),
}))

const mockGet = vi.fn()
const mockAll = vi.fn()
const mockOrderBy = vi.fn(() => ({ all: mockAll }))
const mockWhere = vi.fn(() => ({ get: mockGet, orderBy: mockOrderBy }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))

const mockInsertRun = vi.fn()
const mockInsertValues = vi.fn(() => ({ run: mockInsertRun }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
  },
  agentKeys: {
    id: 'id',
    keyHash: 'key_hash',
    keyPrefix: 'key_prefix',
    orgId: 'org_id',
    name: 'name',
    scopes: 'scopes',
    createdBy: 'created_by',
    createdAt: 'created_at',
    revokedAt: 'revoked_at',
  },
  members: {
    organizationId: 'organization_id',
    userId: 'user_id',
    role: 'role',
  },
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  isNull: vi.fn((v: unknown) => ({ isNull: v })),
  desc: vi.fn((v: unknown) => v),
}))

import { GET, POST } from './route'

const session = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
}

function params(): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId: 'org-1' }) }
}

describe('/api/orgs/[orgId]/agent-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET lists active keys', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet.mockReturnValueOnce({ role: 'owner' })
    mockAll.mockReturnValueOnce([
      {
        id: 'key-1',
        keyHash: 'redacted-hash',
        keyPrefix: 'ak_12345678',
        orgId: 'org-1',
        name: 'CI Agent',
        scopes: JSON.stringify({ documents: ['doc-1'] }),
        createdBy: 'user-1',
        createdAt: new Date('2026-02-12T00:00:00.000Z'),
        lastUsedAt: null,
        revokedAt: null,
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/agent-keys')
    const res = await GET(req, params())
    expect(res.status).toBe(200)
    const body = await res.json() as Array<Record<string, unknown>>
    expect(body).toEqual([
      {
        id: 'key-1',
        keyPrefix: 'ak_12345678',
        name: 'CI Agent',
        scopes: { documents: ['doc-1'], folders: undefined },
        createdBy: 'user-1',
        createdAt: '2026-02-12T00:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ])
    expect(body[0]?.key).toBeUndefined()
    expect(body[0]?.keyHash).toBeUndefined()
  })

  it('POST creates a new key', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet.mockReturnValueOnce({ role: 'admin' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/agent-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Agent Key',
        scopes: { documents: ['doc-1'] },
      }),
    })
    const res = await POST(req, params())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('Agent Key')
    expect(typeof body.key).toBe('string')
    expect(body.key.startsWith('ak_')).toBe(true)
    expect(body.key.length).toBe(43)
    expect(mockInsertValues).toHaveBeenCalledOnce()
    expect(mockInsertRun).toHaveBeenCalledOnce()
  })
})
