// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuthenticateAgentKey = vi.fn()
vi.mock('@/lib/agent-key-auth', () => ({
  authenticateAgentKey: (...args: unknown[]) =>
    mockAuthenticateAgentKey.apply(undefined, args as never),
}))

const mockRateLimit = vi.fn()
const mockRateLimitResponse = vi.fn(() => new Response(null, { status: 429 }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit.apply(undefined, args as never),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse.apply(undefined, args as never),
}))

const mockCheckPermission = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
}))

const mockGet = vi.fn()
const mockWhere = vi.fn(() => ({ get: mockGet }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  documents: {
    id: 'id',
    orgId: 'org_id',
    folderId: 'folder_id',
    agentEditable: 'agent_editable',
    deletedAt: 'deleted_at',
  },
  organizations: {
    id: 'id',
    metadata: 'metadata',
  },
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  isNull: vi.fn((value: unknown) => ({ isNull: value })),
}))

import { authorizeAgentForDocument } from './agent-doc-access'

describe('authorizeAgentForDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateAgentKey.mockResolvedValue({
      context: {
        keyId: 'key-1',
        orgId: 'org-1',
        permissionUserId: 'user-1',
        scopes: {},
      },
    })
    mockRateLimit.mockReturnValue({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 1000,
    })
    mockCheckPermission.mockResolvedValue(true)
  })

  it('blocks mutation access when document is not agent-editable', async () => {
    mockGet.mockReturnValueOnce({
      id: 'doc-1',
      orgId: 'org-1',
      folderId: null,
      agentEditable: false,
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const result = await authorizeAgentForDocument(req, 'doc-1', 'can_edit')

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(403)
    }
    expect(mockCheckPermission).not.toHaveBeenCalled()
  })

  it('allows read access when document is not agent-editable', async () => {
    mockGet.mockReturnValueOnce({
      id: 'doc-1',
      orgId: 'org-1',
      folderId: null,
      agentEditable: false,
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const result = await authorizeAgentForDocument(req, 'doc-1', 'can_view')

    expect('context' in result).toBe(true)
    expect(mockCheckPermission).toHaveBeenCalledOnce()
  })

  it('rejects access when scopes are explicitly empty arrays', async () => {
    mockAuthenticateAgentKey.mockResolvedValueOnce({
      context: {
        keyId: 'key-1',
        orgId: 'org-1',
        permissionUserId: 'user-1',
        scopes: {
          documents: [],
          folders: [],
        },
      },
    })
    mockGet.mockReturnValueOnce({
      id: 'doc-1',
      orgId: 'org-1',
      folderId: 'folder-1',
      agentEditable: true,
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const result = await authorizeAgentForDocument(req, 'doc-1', 'can_view')

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.status).toBe(403)
      expect(await result.error.json()).toEqual({ error: 'forbidden by key scope' })
    }
    expect(mockCheckPermission).not.toHaveBeenCalled()
  })
})
