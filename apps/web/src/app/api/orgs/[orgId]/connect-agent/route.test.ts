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

vi.mock('@/lib/webhook-secret', () => ({
  encryptWebhookSecret: vi.fn((s: string) => `encrypted:${s}`),
}))

const mockDbResult = { get: vi.fn(), run: vi.fn(), all: vi.fn() }
const mockWhereSelect = vi.fn(() => ({ get: mockDbResult.get }))
const mockFrom = vi.fn(() => ({ where: mockWhereSelect }))
const mockWhereUpdate = vi.fn(() => ({ run: mockDbResult.run }))
const mockSet = vi.fn(() => ({ where: mockWhereUpdate }))
const mockInsertValues = vi.fn(() => ({ run: mockDbResult.run }))
const mockInsert = vi.fn(() => ({ values: mockInsertValues }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    update: vi.fn(() => ({ set: mockSet })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
  },
  agentKeys: { id: 'id', orgId: 'org_id', name: 'name' },
  webhooks: { id: 'id', orgId: 'org_id' },
  organizations: { id: 'id', metadata: 'metadata' },
  members: { organizationId: 'organization_id', userId: 'user_id' },
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
}))

import { POST } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(orgId: string): { params: Promise<{ orgId: string }> } {
  return { params: Promise.resolve({ orgId }) }
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/orgs/org-1/connect-agent', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/orgs/[orgId]/connect-agent', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ name: 'writer' }), makeParams('org-1'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not a member', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce(undefined) // no membership

    const res = await POST(makeRequest({ name: 'writer' }), makeParams('org-1'))
    expect(res.status).toBe(403)
  })

  it('returns 403 when user is a regular member (not admin/owner)', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'member' })

    const res = await POST(makeRequest({ name: 'writer' }), makeParams('org-1'))
    expect(res.status).toBe(403)
  })

  it('returns 400 when name is missing', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' })

    const res = await POST(makeRequest({}), makeParams('org-1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('name is required')
  })

  it('returns 400 when name is empty string', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' })

    const res = await POST(makeRequest({ name: '  ' }), makeParams('org-1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('name is required')
  })

  it('returns 400 when webhookUrl is not a valid URL', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' })

    const res = await POST(
      makeRequest({ name: 'writer', webhookUrl: 'not-a-url' }),
      makeParams('org-1'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('webhookUrl must be a valid URL')
  })

  it('returns 400 when webhookUrl uses non-http scheme', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' })

    const res = await POST(
      makeRequest({ name: 'writer', webhookUrl: 'ftp://example.com/hook' }),
      makeParams('org-1'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('webhookUrl must use http or https')
  })

  it('creates API key and returns raw key without webhook', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' }) // membership
    // org lookup for registry update
    mockDbResult.get.mockReturnValueOnce({ id: 'org-1', metadata: '{}' })

    const res = await POST(
      makeRequest({ name: 'writer', description: 'Writes content' }),
      makeParams('org-1'),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.apiKey).toMatch(/^ak_/)
    expect(body.keyPrefix).toBe(body.apiKey.slice(0, 11))
    expect(body.agentName).toBe('writer')
    expect(body.serverUrl).toBeDefined()
    expect(body.webhookSecret).toBeUndefined()
  })

  it('strips leading @ from agent name', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'owner' })
    mockDbResult.get.mockReturnValueOnce({ id: 'org-1', metadata: '{}' })

    const res = await POST(makeRequest({ name: '@reviewer' }), makeParams('org-1'))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.agentName).toBe('reviewer')
  })

  it('creates webhook when webhookUrl is provided', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' })
    mockDbResult.get.mockReturnValueOnce({ id: 'org-1', metadata: '{}' })

    const res = await POST(
      makeRequest({ name: 'writer', webhookUrl: 'https://example.com/hook' }),
      makeParams('org-1'),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.webhookSecret).toMatch(/^whsec_/)
    // insert should be called twice (api key + webhook)
    expect(mockInsertValues).toHaveBeenCalledTimes(2)
  })

  it('adds agent to org registry metadata', async () => {
    mockGetSession.mockResolvedValueOnce(fakeSession)
    mockDbResult.get.mockReturnValueOnce({ role: 'admin' })
    mockDbResult.get.mockReturnValueOnce({
      id: 'org-1',
      metadata: JSON.stringify({
        agents: [{ name: 'existing', description: 'Already there', enabled: true }],
      }),
    })

    const res = await POST(
      makeRequest({ name: 'writer', description: 'Writes stuff' }),
      makeParams('org-1'),
    )

    expect(res.status).toBe(201)
    // Verify metadata was updated with new agent appended
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.stringContaining('"writer"'),
      }),
    )
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.stringContaining('"existing"'),
      }),
    )
  })
})
