// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

const mockAuthorizeAgentForDocument = vi.fn()
vi.mock('@/lib/agent-doc-access', () => ({
  authorizeAgentForDocument: (...args: unknown[]) => mockAuthorizeAgentForDocument.apply(undefined, args as never),
}))

const mockFetchDocFromSyncServer = vi.fn()
const mockReplaceDocOnSyncServer = vi.fn()
vi.mock('@/lib/sync-doc-state', () => ({
  fetchDocFromSyncServer: (...args: unknown[]) => mockFetchDocFromSyncServer.apply(undefined, args as never),
  replaceDocOnSyncServer: (...args: unknown[]) => mockReplaceDocOnSyncServer.apply(undefined, args as never),
}))

vi.mock('@/lib/http', () => ({
  requireJsonContentType: vi.fn(() => null),
}))

import { GET, POST } from './route'

function params(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: 'doc-1' }) }
}

describe('/api/v1/documents/[id]/discussions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorizeAgentForDocument.mockResolvedValue({
      context: { keyId: 'key-1', actorId: 'agent-key:key-1', name: 'Agent' },
      document: { id: 'doc-1', orgId: 'org-1', folderId: null },
    })
  })

  it('GET returns discussion threads', async () => {
    const ydoc = new Y.Doc()
    const ydiscussions = ydoc.getArray<Y.Map<unknown>>('discussions')
    const discussion = new Y.Map<unknown>()
    discussion.set('id', 'd-1')
    const author = new Y.Map<unknown>()
    author.set('userId', 'u-1')
    author.set('name', 'User')
    discussion.set('author', author)
    discussion.set('title', 'Thread title')
    discussion.set('text', 'Thread body')
    discussion.set('createdAt', '2026-02-12T00:00:00.000Z')
    discussion.set('resolved', false)
    discussion.set('thread', new Y.Array<Y.Map<unknown>>())
    ydiscussions.push([discussion])
    mockFetchDocFromSyncServer.mockResolvedValueOnce({ ydoc })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/discussions')
    const res = await GET(req, params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('d-1')
    expect(body[0].title).toBe('Thread title')
  })

  it('POST creates a discussion', async () => {
    const ydoc = new Y.Doc()
    mockFetchDocFromSyncServer.mockResolvedValueOnce({ ydoc })
    mockReplaceDocOnSyncServer.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/discussions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'New Discussion',
        text: 'Discussion body',
      }),
    })
    const res = await POST(req, params())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockReplaceDocOnSyncServer).toHaveBeenCalledOnce()
  })
})
