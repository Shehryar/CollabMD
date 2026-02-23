// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
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

import { GET, PATCH } from './route'

function params(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: 'doc-1' }) }
}

describe('/api/v1/documents/[id]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorizeAgentForDocument.mockResolvedValue({
      context: { keyId: 'key-1' },
      document: { id: 'doc-1', orgId: 'org-1', folderId: null },
    })
  })

  it('GET returns document content', async () => {
    const ydoc = new Y.Doc()
    ydoc.getText('codemirror').insert(0, '# Hello')
    mockFetchDocFromSyncServer.mockResolvedValueOnce({ ydoc })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const res = await GET(req, params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      documentId: 'doc-1',
      orgId: 'org-1',
      content: '# Hello',
    })
  })

  it('PATCH replaces document content', async () => {
    const ydoc = new Y.Doc()
    ydoc.getText('codemirror').insert(0, 'Old')
    mockFetchDocFromSyncServer.mockResolvedValueOnce({ ydoc })
    mockReplaceDocOnSyncServer.mockResolvedValueOnce(null)

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'New content' }),
    })
    const res = await PATCH(req, params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockReplaceDocOnSyncServer).toHaveBeenCalledOnce()
  })

  it('returns 403 when key scope does not include the document', async () => {
    mockAuthorizeAgentForDocument.mockResolvedValueOnce({
      error: NextResponse.json({ error: 'forbidden by key scope' }, { status: 403 }),
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const res = await GET(req, params())

    expect(res.status).toBe(403)
    expect(mockFetchDocFromSyncServer).not.toHaveBeenCalled()
  })

  it('returns 401 when key is revoked or invalid', async () => {
    mockAuthorizeAgentForDocument.mockResolvedValueOnce({
      error: NextResponse.json({ error: 'invalid api key' }, { status: 401 }),
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const res = await GET(req, params())

    expect(res.status).toBe(401)
    expect(mockFetchDocFromSyncServer).not.toHaveBeenCalled()
  })

  it('returns 429 when agent key is rate limited', async () => {
    mockAuthorizeAgentForDocument.mockResolvedValueOnce({
      error: NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 }),
    })

    const req = new NextRequest('http://localhost:3000/api/v1/documents/doc-1/content')
    const res = await GET(req, params())

    expect(res.status).toBe(429)
    expect(mockFetchDocFromSyncServer).not.toHaveBeenCalled()
  })
})
