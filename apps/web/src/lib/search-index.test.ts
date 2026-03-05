// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────

const mockPrepare = vi.fn()
const mockExec = vi.fn()
const mockRun = vi.fn()
const mockAll = vi.fn()
const mockGet = vi.fn()

const mockStmt = {
  run: mockRun,
  all: mockAll,
  get: mockGet,
}

mockPrepare.mockReturnValue(mockStmt)

vi.mock('@collabmd/db', () => ({
  getSqlite: () => ({
    prepare: (...args: unknown[]) => mockPrepare.apply(undefined, args as never),
    exec: (...args: unknown[]) => mockExec.apply(undefined, args as never),
  }),
}))

// ── Import after mocks ─────────────────────────────────────────────────

import {
  indexDocument,
  removeFromSearchIndex,
  searchDocuments,
  indexDocumentFromSnapshot,
} from './search-index'

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockPrepare.mockReturnValue(mockStmt)
})

describe('indexDocument', () => {
  it('deletes existing entry then inserts new one', () => {
    indexDocument('doc-1', 'My Title', 'Hello world content')

    expect(mockPrepare).toHaveBeenCalledTimes(2)
    expect(mockPrepare).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM document_search WHERE document_id = ?',
    )
    expect(mockPrepare).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO document_search (document_id, title, content) VALUES (?, ?, ?)',
    )

    expect(mockRun).toHaveBeenCalledTimes(2)
    expect(mockRun).toHaveBeenNthCalledWith(1, 'doc-1')
    expect(mockRun).toHaveBeenNthCalledWith(2, 'doc-1', 'My Title', 'Hello world content')
  })
})

describe('removeFromSearchIndex', () => {
  it('deletes the document entry from FTS index', () => {
    removeFromSearchIndex('doc-1')

    expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM document_search WHERE document_id = ?')
    expect(mockRun).toHaveBeenCalledWith('doc-1')
  })
})

describe('searchDocuments', () => {
  it('returns empty array for empty query', () => {
    const results = searchDocuments('', ['doc-1'])
    expect(results).toEqual([])
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('returns empty array for empty accessible IDs', () => {
    const results = searchDocuments('hello', [])
    expect(results).toEqual([])
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('queries FTS5 with sanitized query and filters by accessible IDs', () => {
    mockAll.mockReturnValueOnce([
      {
        document_id: 'doc-1',
        title_snippet: 'My <mark>Title</mark>',
        content_snippet: 'Hello <mark>world</mark> content',
      },
    ])

    const results = searchDocuments('world', ['doc-1', 'doc-2'])

    expect(mockPrepare).toHaveBeenCalledTimes(1)
    const sqlQuery = mockPrepare.mock.calls[0][0] as string
    expect(sqlQuery).toContain('document_search MATCH ?')
    expect(sqlQuery).toContain('document_id IN (?,?)')

    // The sanitized query wraps the token in quotes with prefix match
    expect(mockAll).toHaveBeenCalledWith('"world"*', 'doc-1', 'doc-2')

    expect(results).toEqual([
      {
        documentId: 'doc-1',
        snippet: 'Hello <mark>world</mark> content',
      },
    ])
  })

  it('falls back to title snippet when content snippet is empty', () => {
    mockAll.mockReturnValueOnce([
      {
        document_id: 'doc-1',
        title_snippet: 'My <mark>Title</mark>',
        content_snippet: '',
      },
    ])

    const results = searchDocuments('Title', ['doc-1'])

    expect(results).toEqual([
      {
        documentId: 'doc-1',
        snippet: 'My <mark>Title</mark>',
      },
    ])
  })

  it('handles multi-word queries with prefix match on last token', () => {
    mockAll.mockReturnValueOnce([])

    searchDocuments('hello wor', ['doc-1'])

    // First token exact, last token prefix
    expect(mockAll).toHaveBeenCalledWith('"hello" "wor"*', 'doc-1')
  })

  it('strips quotes from user input to prevent FTS5 syntax errors', () => {
    mockAll.mockReturnValueOnce([])

    searchDocuments('"hello" \'world\'', ['doc-1'])

    expect(mockAll).toHaveBeenCalledWith('"hello" "world"*', 'doc-1')
  })
})

describe('indexDocumentFromSnapshot', () => {
  it('indexes title only when snapshot is null', () => {
    indexDocumentFromSnapshot('doc-1', 'Title', null)

    expect(mockPrepare).toHaveBeenCalledTimes(2)
    expect(mockRun).toHaveBeenNthCalledWith(1, 'doc-1')
    expect(mockRun).toHaveBeenNthCalledWith(2, 'doc-1', 'Title', '')
  })

  it('indexes title only when snapshot is empty', () => {
    indexDocumentFromSnapshot('doc-1', 'Title', Buffer.alloc(0))

    expect(mockRun).toHaveBeenNthCalledWith(2, 'doc-1', 'Title', '')
  })
})
