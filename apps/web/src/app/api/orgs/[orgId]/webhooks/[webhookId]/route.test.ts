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

const mockGet = vi.fn()
const mockRun = vi.fn()
const mockWhereSelect = vi.fn(() => ({ get: mockGet }))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockWhereDelete = vi.fn(() => ({ run: mockRun }))
const mockDelete = vi.fn(() => ({ where: mockWhereDelete }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    delete: (...args: unknown[]) => mockDelete.apply(undefined, args as never),
  },
  webhooks: {
    id: 'id',
    orgId: 'org_id',
  },
  members: {
    organizationId: 'organization_id',
    userId: 'user_id',
    role: 'role',
  },
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}))

import { DELETE } from './route'

const session = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
}

function params(): { params: Promise<{ orgId: string; webhookId: string }> } {
  return { params: Promise.resolve({ orgId: 'org-1', webhookId: 'wh-1' }) }
}

describe('DELETE /api/orgs/[orgId]/webhooks/[webhookId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 if webhook does not exist', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet.mockReturnValueOnce({ role: 'owner' }).mockReturnValueOnce(undefined)

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks/wh-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, params())
    expect(res.status).toBe(404)
  })

  it('deletes webhook', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet
      .mockReturnValueOnce({ role: 'admin' })
      .mockReturnValueOnce({ id: 'wh-1', orgId: 'org-1' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/webhooks/wh-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRun).toHaveBeenCalledOnce()
  })
})
