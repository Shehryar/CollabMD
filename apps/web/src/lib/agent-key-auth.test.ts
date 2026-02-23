// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

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
    keyHash: 'key_hash',
    keyPrefix: 'key_prefix',
    orgId: 'org_id',
    name: 'name',
    createdBy: 'created_by',
    scopes: 'scopes',
    revokedAt: 'revoked_at',
  },
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  isNull: vi.fn((value: unknown) => ({ isNull: value })),
}))

import { authenticateAgentKey } from './agent-key-auth'

describe('authenticateAgentKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 for missing key', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const result = await authenticateAgentKey(req)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
  })

  it('authenticates valid key and updates lastUsedAt', async () => {
    const rawKey = 'ak_0123456789abcdef0123456789abcdef01234567'
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')

    mockGet.mockReturnValueOnce({
      id: 'key-1',
      keyPrefix: 'ak_01234567',
      orgId: 'org-1',
      name: 'Agent',
      createdBy: 'user-1',
      scopes: JSON.stringify({ documents: ['doc-1'] }),
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content', {
      headers: { authorization: `Bearer ${rawKey}` },
    })
    const result = await authenticateAgentKey(req)
    expect('context' in result).toBe(true)
    if ('context' in result) {
      expect(result.context.keyId).toBe('key-1')
      expect(result.context.orgId).toBe('org-1')
      expect(result.context.permissionUserId).toBe('user-1')
    }
    expect(mockRun).toHaveBeenCalledOnce()
    expect(mockWhereSelect).toHaveBeenCalled()
    expect(keyHash).toBeTypeOf('string')
  })

  it('returns 401 for revoked keys and does not update lastUsedAt', async () => {
    const rawKey = 'ak_deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    mockGet.mockReturnValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content', {
      headers: { authorization: `Bearer ${rawKey}` },
    })
    const result = await authenticateAgentKey(req)

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(401)
    }
    expect(mockRun).not.toHaveBeenCalled()
  })
})
