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

const mockGet = vi.fn()
const mockAll = vi.fn()
const mockOrderBy = vi.fn(() => ({ limit: vi.fn(() => ({ all: mockAll })) }))
const mockWhere = vi.fn(() => ({ get: mockGet, orderBy: mockOrderBy }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  webhooks: {
    id: 'id',
    orgId: 'org_id',
  },
  webhookDeliveries: {
    webhookId: 'webhook_id',
    lastAttemptAt: 'last_attempt_at',
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

import { GET } from './route'

const session = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
}

function params(): { params: Promise<{ orgId: string; webhookId: string }> } {
  return { params: Promise.resolve({ orgId: 'org-1', webhookId: 'wh-1' }) }
}

describe('GET /api/orgs/[orgId]/webhooks/[webhookId]/deliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns webhook deliveries', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet
      .mockReturnValueOnce({ role: 'owner' })
      .mockReturnValueOnce({ id: 'wh-1', orgId: 'org-1' })
    mockAll.mockReturnValueOnce([
      {
        id: 'delivery-1',
        webhookId: 'wh-1',
        eventType: 'document.edited',
        payload: JSON.stringify({ doc: 'doc-1' }),
        statusCode: 200,
        responseBody: 'ok',
        attemptCount: 1,
        lastAttemptAt: new Date('2026-02-12T00:00:00.000Z'),
        createdAt: new Date('2026-02-12T00:00:00.000Z'),
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks/wh-1/deliveries')
    const res = await GET(req, params())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        id: 'delivery-1',
        webhookId: 'wh-1',
        eventType: 'document.edited',
        payload: { doc: 'doc-1' },
        statusCode: 200,
        responseBody: 'ok',
        attemptCount: 1,
        lastAttemptAt: '2026-02-12T00:00:00.000Z',
        createdAt: '2026-02-12T00:00:00.000Z',
      },
    ])
  })
})
