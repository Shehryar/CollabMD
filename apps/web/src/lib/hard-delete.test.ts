// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadTuplesForEntity = vi.fn()
const mockDeleteTuple = vi.fn()
vi.mock('@collabmd/shared', () => ({
  readTuplesForEntity: (...args: unknown[]) => mockReadTuplesForEntity.apply(undefined, args as never),
  deleteTuple: (...args: unknown[]) => mockDeleteTuple.apply(undefined, args as never),
}))

const mockRun = vi.fn()
const mockWhere = vi.fn(() => ({ run: mockRun }))
const mockTxDelete = vi.fn(() => ({ where: mockWhere }))
const mockTransaction = vi.fn((callback: (tx: { delete: typeof mockTxDelete }) => void) => {
  callback({ delete: mockTxDelete })
})
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))

vi.mock('@collabmd/db', () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction.apply(undefined, args as never),
  },
  documents: {
    id: 'id',
  },
  shareLinks: {
    documentId: 'document_id',
  },
  documentSnapshots: {
    documentId: 'document_id',
  },
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
}))

import { hardDeleteDocument } from './hard-delete'

describe('hardDeleteDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadTuplesForEntity.mockResolvedValue([])
  })

  it('cleans up all FGA tuples and deletes related rows in one transaction', async () => {
    mockReadTuplesForEntity.mockResolvedValueOnce([
      { user: 'user:user-1', relation: 'viewer', object: 'document:doc-1' },
      { user: 'folder:folder-1', relation: 'parent', object: 'document:doc-1' },
    ])

    await hardDeleteDocument('doc-1')

    expect(mockReadTuplesForEntity).toHaveBeenCalledWith('document:doc-1')
    expect(mockDeleteTuple).toHaveBeenCalledTimes(2)
    expect(mockDeleteTuple).toHaveBeenNthCalledWith(
      1,
      'user:user-1',
      'viewer',
      'document:doc-1',
    )
    expect(mockDeleteTuple).toHaveBeenNthCalledWith(
      2,
      'folder:folder-1',
      'parent',
      'document:doc-1',
    )

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTxDelete).toHaveBeenCalledTimes(3)
    expect(mockEq).toHaveBeenCalledTimes(3)
    expect(mockRun).toHaveBeenCalledTimes(3)
  })

  it('still deletes DB rows when there are no tuples to remove', async () => {
    mockReadTuplesForEntity.mockResolvedValueOnce([])

    await hardDeleteDocument('doc-2')

    expect(mockDeleteTuple).not.toHaveBeenCalled()
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTxDelete).toHaveBeenCalledTimes(3)
    expect(mockRun).toHaveBeenCalledTimes(3)
  })
})
