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

const mockEnforceUserMutationRateLimit = vi.fn(() => null)
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) =>
    mockEnforceUserMutationRateLimit.apply(undefined, args as never),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/http', () => ({
  requireJsonContentType: vi.fn(() => null),
}))

const mockGet = vi.fn()
const mockAll = vi.fn()
const mockOrderBy = vi.fn(() => ({ all: mockAll }))
const mockWhere = vi.fn(() => ({
  get: mockGet,
  all: mockAll,
  orderBy: mockOrderBy,
}))
const mockFrom = vi.fn(() => ({ where: mockWhere }))

const mockInsertRun = vi.fn()
const mockInsertValues = vi.fn(() => ({ run: mockInsertRun }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
  },
  webhooks: {
    id: 'id',
    orgId: 'org_id',
    url: 'url',
    secret: 'secret',
    events: 'events',
    createdBy: 'created_by',
    createdAt: 'created_at',
    active: 'active',
  },
  members: {
    organizationId: 'organization_id',
    userId: 'user_id',
    role: 'role',
  },
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  desc: vi.fn((value: unknown) => value),
}))

import { GET, POST } from './route'

const session = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
}

function params(orgId = 'org-1'): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) }
}

describe('/api/orgs/[orgId]/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 when unauthorized', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks')
    const res = await GET(req, params())
    expect(res.status).toBe(401)
  })

  it('GET returns webhook list for admin', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet.mockReturnValueOnce({ role: 'admin' })
    mockAll.mockReturnValueOnce([
      {
        id: 'wh-1',
        orgId: 'org-1',
        url: 'https://example.com/hook',
        secret: 'secret-1',
        events: JSON.stringify(['document.edited', 'comment.created']),
        createdBy: 'user-1',
        createdAt: new Date('2026-02-12T00:00:00.000Z'),
        active: true,
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks')
    const res = await GET(req, params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        id: 'wh-1',
        orgId: 'org-1',
        url: 'https://example.com/hook',
        events: ['document.edited', 'comment.created'],
        createdBy: 'user-1',
        createdAt: '2026-02-12T00:00:00.000Z',
        active: true,
      },
    ])
  })

  it('POST creates webhook', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet.mockReturnValueOnce({ role: 'owner' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/hook',
        secret: 'secret-value',
        events: ['document.edited', 'comment.created'],
      }),
    })

    const res = await POST(req, params())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.url).toBe('https://example.com/hook')
    expect(body.secret).toBe('secret-value')
    expect(body.events).toEqual(['document.edited', 'comment.created'])
    const insertedCall = mockInsertValues.mock.calls[0] as unknown[] | undefined
    const inserted = insertedCall?.[0] as { secret?: string } | undefined
    expect(inserted?.secret).toMatch(/^enc:v1:/)
    expect(inserted?.secret).not.toBe('secret-value')
    expect(mockInsertValues).toHaveBeenCalledOnce()
    expect(mockInsertRun).toHaveBeenCalledOnce()
  })

  it('POST rejects invalid events', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet.mockReturnValueOnce({ role: 'owner' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/hook',
        events: ['invalid.event'],
      }),
    })

    const res = await POST(req, params())
    expect(res.status).toBe(400)
  })

  it('POST rejects non-http webhook URLs', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet.mockReturnValueOnce({ role: 'owner' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'ftp://example.com/hook',
        events: ['document.edited'],
      }),
    })

    const res = await POST(req, params())
    expect(res.status).toBe(400)
  })
})
