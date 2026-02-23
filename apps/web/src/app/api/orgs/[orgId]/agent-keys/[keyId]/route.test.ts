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

const mockGet = vi.fn()
const mockRun = vi.fn()
const mockWhereSelect = vi.fn(() => ({ get: mockGet }))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockWhereUpdate = vi.fn(() => ({ run: mockRun }))
const mockSet = vi.fn(() => ({ where: mockWhereUpdate }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    update: vi.fn(() => ({ set: mockSet })),
  },
  agentKeys: {
    id: 'id',
    orgId: 'org_id',
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
}))

import { DELETE } from './route'

const session = {
  user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
}

function params(): { params: Promise<{ orgId: string; keyId: string }> } {
  return { params: Promise.resolve({ orgId: 'org-1', keyId: 'key-1' }) }
}

describe('DELETE /api/orgs/[orgId]/agent-keys/[keyId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('revokes an existing key', async () => {
    mockGetSession.mockResolvedValueOnce(session)
    mockGet
      .mockReturnValueOnce({ role: 'owner' })
      .mockReturnValueOnce({ id: 'key-1', orgId: 'org-1' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/agent-keys/key-1', { method: 'DELETE' })
    const res = await DELETE(req, params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRun).toHaveBeenCalledOnce()
  })
})
