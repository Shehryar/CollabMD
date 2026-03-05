// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/http', () => ({
  requireJsonContentType: vi.fn(() => null),
}))

const mockDbResult = { get: vi.fn(), run: vi.fn() }
const mockWhereSelect = vi.fn(() => ({ get: mockDbResult.get }))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockWhereUpdate = vi.fn(() => ({ run: mockDbResult.run }))
const mockSet = vi.fn(() => ({ where: mockWhereUpdate }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    update: vi.fn(() => ({ set: mockSet })),
  },
  organizations: { id: 'id', metadata: 'metadata' },
  members: { organizationId: 'organization_id', userId: 'user_id' },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
}))

import { GET, PATCH } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/orgs/[orgId]/settings', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings')
    const res = await GET(req, makeParams('org-1'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not a member', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce(undefined) // no membership

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings')
    const res = await GET(req, makeParams('org-1'))
    expect(res.status).toBe(403)
  })

  it('returns default settings when org has no metadata', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' }) // membership
    mockDbResult.get.mockReturnValueOnce({ id: 'org-1', metadata: null }) // org

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings')
    const res = await GET(req, makeParams('org-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.defaultDocPermission).toBe('none')
    expect(body.agentPolicy).toBe('enabled')
    expect(body.agents).toEqual([])
  })

  it('returns agentPolicy from org metadata', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'owner' })
    mockDbResult.get.mockReturnValueOnce({
      id: 'org-1',
      metadata: JSON.stringify({
        defaultDocPermission: 'viewer',
        agentPolicy: 'restricted',
        agents: [{ name: 'reviewer', description: 'Code review assistant', enabled: true }],
      }),
    })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings')
    const res = await GET(req, makeParams('org-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentPolicy).toBe('restricted')
    expect(body.defaultDocPermission).toBe('viewer')
    expect(body.agents).toEqual([
      { name: 'reviewer', description: 'Code review assistant', enabled: true },
    ])
  })
})

describe('PATCH /api/orgs/[orgId]/settings', () => {
  it('returns 403 when user is not admin/owner', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'member' }) // membership, not admin

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agentPolicy: 'disabled' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, makeParams('org-1'))
    expect(res.status).toBe(403)
  })

  it('updates agentPolicy when user is admin', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' }) // membership
    mockDbResult.get.mockReturnValueOnce({ id: 'org-1', metadata: '{}' }) // org

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agentPolicy: 'disabled' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, makeParams('org-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agentPolicy).toBe('disabled')
  })

  it('rejects invalid agentPolicy value', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'owner' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agentPolicy: 'invalid' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, makeParams('org-1'))
    expect(res.status).toBe(400)
  })

  it('updates only agentPolicy without changing defaultDocPermission', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'owner' })
    mockDbResult.get.mockReturnValueOnce({
      id: 'org-1',
      metadata: JSON.stringify({ defaultDocPermission: 'editor' }),
    })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agentPolicy: 'restricted' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, makeParams('org-1'))

    expect(res.status).toBe(200)
    // Verify the metadata update preserves defaultDocPermission
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.stringContaining('"defaultDocPermission":"editor"'),
      }),
    )
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.stringContaining('"agentPolicy":"restricted"'),
      }),
    )
  })

  it('updates agents when provided', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'owner' })
    mockDbResult.get.mockReturnValueOnce({
      id: 'org-1',
      metadata: JSON.stringify({ defaultDocPermission: 'editor' }),
    })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        agents: [
          { name: 'writer', description: 'Drafts content', enabled: true },
          { name: 'qa', description: 'Checks docs', enabled: false },
        ],
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, makeParams('org-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agents).toEqual([
      { name: 'writer', description: 'Drafts content', enabled: true },
      { name: 'qa', description: 'Checks docs', enabled: false },
    ])
  })

  it('rejects invalid agents payload', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'owner' })

    const req = new NextRequest('http://localhost:3000/api/orgs/org-1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ agents: 'invalid' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, makeParams('org-1'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid agents; must be an array' })
  })
})
