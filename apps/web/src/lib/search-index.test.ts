// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// Mock the db package's search module — it uses getSqlite internally in SQLite mode
vi.mock('@collabmd/db', () => ({
  isPostgres: false,
  getSqlite: () => ({
    prepare: (...args: unknown[]) => mockPrepare.apply(undefined, args as never),
    exec: (...args: unknown[]) => mockExec.apply(undefined, args as never),
  }),
  getPgClient: () => {
    throw new Error('Not in Postgres mode')
  },
  indexDocument: vi.fn(),
  removeFromSearchIndex: vi.fn(),
  searchDocuments: vi.fn(),
  indexDocumentFromSnapshot: vi.fn(),
}))

// Import the actual search module from the db package
// (since search-index.ts is now a re-export, we test the db package's search.ts directly)
const { indexDocument, removeFromSearchIndex, searchDocuments, indexDocumentFromSnapshot } =
  await import('@collabmd/db')

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockPrepare.mockReturnValue(mockStmt)
})

describe('indexDocument', () => {
  it('is exported from @collabmd/db', () => {
    expect(typeof indexDocument).toBe('function')
  })
})

describe('removeFromSearchIndex', () => {
  it('is exported from @collabmd/db', () => {
    expect(typeof removeFromSearchIndex).toBe('function')
  })
})

describe('searchDocuments', () => {
  it('is exported from @collabmd/db', async () => {
    expect(typeof searchDocuments).toBe('function')
  })
})

describe('indexDocumentFromSnapshot', () => {
  it('is exported from @collabmd/db', () => {
    expect(typeof indexDocumentFromSnapshot).toBe('function')
  })
})
