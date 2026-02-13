// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

const mockAll = vi.fn()
const mockOrderBy = vi.fn(() => ({ all: mockAll }))
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
const mockIsNotNull = vi.fn((a: unknown) => ({ isNotNull: a }))
const mockAnd = vi.fn((...args: unknown[]) => ({ and: args }))
const mockDesc = vi.fn((a: unknown) => ({ desc: a }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  documents: {
    ownerId: 'owner_id',
    deletedAt: 'deleted_at',
  },
  eq: (...args: unknown[]) => mockEq(...args),
  and: (...args: unknown[]) => mockAnd(...args),
  isNotNull: (...args: unknown[]) => mockIsNotNull(...args),
  desc: (...args: unknown[]) => mockDesc(...args),
}))

import { GET } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

describe('GET /api/documents/trash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockAll.mockReturnValue([])
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('returns owner trashed documents ordered by deletedAt desc', async () => {
    const trashedDocs = [
      { id: 'doc-2', title: 'Second', deletedAt: new Date('2026-02-01T00:00:00.000Z') },
      { id: 'doc-1', title: 'First', deletedAt: new Date('2026-01-31T00:00:00.000Z') },
    ]
    mockAll.mockReturnValueOnce(trashedDocs)

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'doc-2', title: 'Second', deletedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'doc-1', title: 'First', deletedAt: '2026-01-31T00:00:00.000Z' },
    ])

    expect(mockEq).toHaveBeenCalledWith('owner_id', 'user-1')
    expect(mockIsNotNull).toHaveBeenCalledWith('deleted_at')
    expect(mockAnd).toHaveBeenCalledTimes(1)
    expect(mockDesc).toHaveBeenCalledWith('deleted_at')
    expect(mockOrderBy).toHaveBeenCalledTimes(1)
  })
})
