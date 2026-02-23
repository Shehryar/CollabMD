import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollabMDClient } from './api-client.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('CollabMDClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('paginates document listing and sends auth headers', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `doc-${index}`,
      title: `Doc ${index}`,
      folderId: null,
      createdAt: '2026-02-12T00:00:00.000Z',
      updatedAt: '2026-02-12T00:00:00.000Z',
    }))
    const secondPage = [
      {
        id: 'doc-100',
        title: 'Doc 100',
        folderId: null,
        createdAt: '2026-02-12T00:00:00.000Z',
        updatedAt: '2026-02-12T00:00:00.000Z',
      },
    ]
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage))

    const client = new CollabMDClient('http://localhost:3000', 'ak_test')
    const docs = await client.listDocuments()

    expect(docs).toHaveLength(101)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/api/v1/documents?limit=100&offset=0',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer ak_test',
          'user-agent': '@collabmd/mcp-server/0.1.0',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/api/v1/documents?limit=100&offset=100',
      expect.any(Object),
    )
  })

  it('fails when anchorText is ambiguous', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      documentId: 'doc-1',
      content: 'repeat here\nrepeat there',
    }))

    const client = new CollabMDClient('http://localhost:3000', 'ak_test')

    await expect(client.addComment('doc-1', 'note', 'repeat')).rejects.toThrow('anchor text is ambiguous')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('adds a comment with resolved anchor offsets when anchorText is unique', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        documentId: 'doc-1',
        content: 'hello world',
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 201))

    const client = new CollabMDClient('http://localhost:3000', 'ak_test')
    await client.addComment('doc-1', 'note', 'world')

    const secondCall = fetchMock.mock.calls[1]
    expect(secondCall?.[0]).toBe('http://localhost:3000/api/v1/documents/doc-1/comments')
    const options = secondCall?.[1] as RequestInit
    expect(options.method).toBe('POST')
    expect(options.body).toBe(JSON.stringify({
      text: 'note',
      from: 6,
      to: 11,
    }))
  })
})
