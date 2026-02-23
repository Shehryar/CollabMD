// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import * as Y from 'yjs'

const mockAuthenticateAgentKey = vi.fn()
vi.mock('@/lib/agent-key-auth', () => ({
  authenticateAgentKey: (...args: unknown[]) => mockAuthenticateAgentKey.apply(undefined, args as never),
}))

const mockRateLimit = vi.fn(() => ({
  success: true,
  limit: 100,
  remaining: 99,
  reset: Date.now() + 60_000,
}))
const mockRateLimitResponse = vi.fn(() => NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit.apply(undefined, args as never),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse.apply(undefined, args as never),
}))

vi.mock('@/lib/sync-url', () => ({
  getSyncHttpUrl: () => 'http://localhost:4444',
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

const originalFetch = globalThis.fetch

function createMockSnapshot(comments: Array<{
  id: string
  text: string
  resolved: boolean
  thread: Array<{ authorName: string; text: string }>
  anchorFrom?: number
  anchorTo?: number
}>): Uint8Array {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('codemirror')
  ytext.insert(0, 'line one\nline two\nline three\nline four\nline five')
  const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
  for (const c of comments) {
    ydoc.transact(() => {
      const comment = new Y.Map<unknown>()
      comment.set('id', c.id)
      comment.set('text', c.text)
      comment.set('resolved', c.resolved)
      comment.set('authorId', 'user-1')
      comment.set('authorName', 'User')
      comment.set('source', 'browser')
      comment.set('createdAt', '2026-02-22T00:00:00.000Z')
      const from = c.anchorFrom ?? 0
      const to = c.anchorTo ?? 8
      comment.set('anchorStart', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, from)))
      comment.set('anchorEnd', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, to)))
      const thread = new Y.Array<Y.Map<unknown>>()
      for (const r of c.thread) {
        const reply = new Y.Map<unknown>()
        reply.set('authorName', r.authorName)
        reply.set('authorId', r.authorName)
        reply.set('text', r.text)
        reply.set('createdAt', '2026-02-22T01:00:00.000Z')
        thread.push([reply])
      }
      comment.set('thread', thread)
      ycomments.push([comment])
    })
  }
  const update = Y.encodeStateAsUpdate(ydoc)
  ydoc.destroy()
  return update
}

function mockFetchSnapshot(snapshot: Uint8Array) {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response(Buffer.from(snapshot), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }),
  )
}

describe('/api/v1/mentions/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
    mockAuthenticateAgentKey.mockResolvedValue({
      context: {
        keyId: 'key-1',
        orgId: 'org-1',
        name: 'writer',
        scopes: {},
      },
    })
    mockRateLimit.mockReturnValue({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60_000,
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns pending mentions for the authenticated agent', async () => {
    mockAll.mockReturnValue([
      { id: 'doc-1', title: 'First document' },
    ])

    const snapshot = createMockSnapshot([
      {
        id: 'comment-1',
        text: '@writer please review this section',
        resolved: false,
        thread: [],
      },
    ])
    mockFetchSnapshot(snapshot)

    const req = new NextRequest('http://localhost:3000/api/v1/mentions/pending')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].documentId).toBe('doc-1')
    expect(body[0].documentTitle).toBe('First document')
    expect(body[0].commentId).toBe('comment-1')
    expect(body[0].commentText).toBe('@writer please review this section')
    expect(body[0].anchorText).toBe('line one')
    expect(typeof body[0].surroundingContext).toBe('string')
    expect(body[0].surroundingContext.length).toBeGreaterThan(0)
  })

  it('excludes mentions where agent has already replied', async () => {
    mockAll.mockReturnValue([
      { id: 'doc-1', title: 'First document' },
    ])

    const snapshot = createMockSnapshot([
      {
        id: 'comment-1',
        text: '@writer review this',
        resolved: false,
        thread: [{ authorName: 'writer', text: 'Done reviewing' }],
      },
    ])
    mockFetchSnapshot(snapshot)

    const req = new NextRequest('http://localhost:3000/api/v1/mentions/pending')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(0)
  })

  it('excludes resolved comments', async () => {
    mockAll.mockReturnValue([
      { id: 'doc-1', title: 'First document' },
    ])

    const snapshot = createMockSnapshot([
      {
        id: 'comment-1',
        text: '@writer review this',
        resolved: true,
        thread: [],
      },
    ])
    mockFetchSnapshot(snapshot)

    const req = new NextRequest('http://localhost:3000/api/v1/mentions/pending')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(0)
  })

  it('filters by documentId query param', async () => {
    mockAll.mockReturnValue([
      { id: 'doc-1', title: 'First document' },
    ])

    const snapshot = createMockSnapshot([
      {
        id: 'comment-1',
        text: '@writer review',
        resolved: false,
        thread: [],
      },
    ])
    mockFetchSnapshot(snapshot)

    const req = new NextRequest('http://localhost:3000/api/v1/mentions/pending?documentId=doc-1')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].documentId).toBe('doc-1')
    // Verify the eq filter was called with the documentId
    expect(mockEq).toHaveBeenCalledWith('id', 'doc-1')
  })

  it('returns 401 for invalid auth', async () => {
    mockAuthenticateAgentKey.mockResolvedValueOnce({
      error: NextResponse.json({ error: 'invalid api key' }, { status: 401 }),
    })

    const req = new NextRequest('http://localhost:3000/api/v1/mentions/pending')
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

    const req = new NextRequest('http://localhost:3000/api/v1/mentions/pending')
    const res = await GET(req)

    expect(res.status).toBe(429)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('case-insensitive agent name matching', async () => {
    mockAuthenticateAgentKey.mockResolvedValueOnce({
      context: {
        keyId: 'key-1',
        orgId: 'org-1',
        name: 'Writer',
        scopes: {},
      },
    })

    mockAll.mockReturnValue([
      { id: 'doc-1', title: 'First document' },
    ])

    const snapshot = createMockSnapshot([
      {
        id: 'comment-1',
        text: '@writer please review',
        resolved: false,
        thread: [],
      },
    ])
    mockFetchSnapshot(snapshot)

    const req = new NextRequest('http://localhost:3000/api/v1/mentions/pending')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].commentId).toBe('comment-1')
  })
})
