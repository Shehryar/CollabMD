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

describe('/api/v1/documents/[id]/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorizeAgentForDocument.mockResolvedValue({
      context: { keyId: 'key-1', actorId: 'agent-key:key-1', name: 'Agent' },
      document: { id: 'doc-1', orgId: 'org-1', folderId: null },
    })
  })

  it('GET lists comments', async () => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    ytext.insert(0, 'hello world')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
    const comment = new Y.Map<unknown>()
    comment.set('id', 'c-1')
    comment.set('authorId', 'u-1')
    comment.set('authorName', 'User')
    comment.set('source', 'browser')
    comment.set('text', 'Note')
    comment.set('createdAt', '2026-02-12T00:00:00.000Z')
    comment.set('resolved', false)
    comment.set('thread', new Y.Array<Y.Map<unknown>>())
    ycomments.push([comment])
    mockFetchDocFromSyncServer.mockResolvedValueOnce({ ydoc })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/comments')
    const res = await GET(req, params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('c-1')
    expect(body[0].text).toBe('Note')
  })

  it('POST creates a comment and syncs state', async () => {
    const ydoc = new Y.Doc()
    ydoc.getText('codemirror').insert(0, 'hello world')
    mockFetchDocFromSyncServer.mockResolvedValueOnce({ ydoc })
    let createdSource: unknown = null
    mockReplaceDocOnSyncServer.mockImplementationOnce(async (_docId: string, nextDoc: Y.Doc) => {
      const comments = nextDoc.getArray<Y.Map<unknown>>('comments')
      const created = comments.get(0)
      createdSource = created?.get('source')
      return null
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Agent note',
        from: 0,
        to: 5,
      }),
    })
    const res = await POST(req, params())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockReplaceDocOnSyncServer).toHaveBeenCalledOnce()
    expect(createdSource).toBe('agent')
  })
})
