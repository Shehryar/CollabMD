// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInvitesAll,
  mockUserGet,
  mockDeleteRun,
  mockWriteTuple,
  pendingResourceInvitesTable,
  usersTable,
  mockWhere,
  mockFrom,
  mockDeleteWhere,
  mockDelete,
  mockEq,
} = vi.hoisted(() => {
  const mockInvitesAll = vi.fn()
  const mockUserGet = vi.fn()
  const mockDeleteRun = vi.fn()
  const mockWriteTuple = vi.fn()

  const pendingResourceInvitesTable = {
    id: 'pending_invite_id',
    email: 'pending_invite_email',
  }
  const usersTable = {
    id: 'user_id',
    email: 'user_email',
  }

  const mockWhere = vi.fn(() => ({
    all: mockInvitesAll,
    get: mockUserGet,
  }))
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  const mockDeleteWhere = vi.fn(() => ({ run: mockDeleteRun }))
  const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }))
  const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))

  return {
    mockInvitesAll,
    mockUserGet,
    mockDeleteRun,
    mockWriteTuple,
    pendingResourceInvitesTable,
    usersTable,
    mockWhere,
    mockFrom,
    mockDeleteWhere,
    mockDelete,
    mockEq,
  }
})

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    delete: mockDelete,
  },
  pendingResourceInvites: pendingResourceInvitesTable,
  users: usersTable,
  eq: (...args: unknown[]) => mockEq(...args),
}))

vi.mock('@collabmd/shared', () => ({
  writeTuple: (...args: unknown[]) => mockWriteTuple(...args),
}))

import {
  applyPendingResourceInvitesForUser,
  applyPendingResourceInvitesForUserId,
} from './pending-resource-invites'

beforeEach(() => {
  vi.clearAllMocks()
  mockDeleteRun.mockResolvedValue(undefined)
})

describe('pending resource invite claiming', () => {
  it('retries tuple writes and deletes the invite after success', async () => {
    mockInvitesAll.mockResolvedValueOnce([
      {
        id: 'invite-1',
        role: 'viewer',
        resourceType: 'document',
        resourceId: 'doc-1',
      },
    ])
    mockWriteTuple
      .mockRejectedValueOnce(new Error('openfga unavailable'))
      .mockResolvedValueOnce(undefined)

    const result = await applyPendingResourceInvitesForUser(
      { id: 'user-1', email: 'Test@Example.com' },
      { maxAttempts: 2, retryDelayMs: 0 },
    )

    expect(result).toEqual({ claimed: 1, failed: 0 })
    expect(mockWriteTuple).toHaveBeenCalledTimes(2)
    expect(mockWriteTuple).toHaveBeenLastCalledWith('user:user-1', 'viewer', 'document:doc-1', {
      actorId: 'user-1',
      source: 'invite-accept',
    })
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockDeleteWhere).toHaveBeenCalledWith({ eq: [pendingResourceInvitesTable.id, 'invite-1'] })
  })

  it('keeps the pending invite when all retries fail', async () => {
    mockInvitesAll.mockResolvedValueOnce([
      {
        id: 'invite-2',
        role: 'editor',
        resourceType: 'folder',
        resourceId: 'folder-1',
      },
    ])
    mockWriteTuple.mockRejectedValue(new Error('network blip'))

    const result = await applyPendingResourceInvitesForUser(
      { id: 'user-2', email: 'user2@example.com' },
      { maxAttempts: 2, retryDelayMs: 0 },
    )

    expect(result).toEqual({ claimed: 0, failed: 1 })
    expect(mockWriteTuple).toHaveBeenCalledTimes(2)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('can re-apply invites by user id during session creation', async () => {
    mockUserGet.mockResolvedValueOnce({ id: 'user-3', email: 'user3@example.com' })
    mockInvitesAll.mockResolvedValueOnce([
      {
        id: 'invite-3',
        role: 'commenter',
        resourceType: 'document',
        resourceId: 'doc-3',
      },
    ])
    mockWriteTuple.mockResolvedValueOnce(undefined)

    const result = await applyPendingResourceInvitesForUserId('user-3', {
      maxAttempts: 1,
      retryDelayMs: 0,
    })

    expect(result).toEqual({ claimed: 1, failed: 0 })
    expect(mockWhere).toHaveBeenCalledTimes(2)
    expect(mockWriteTuple).toHaveBeenCalledWith('user:user-3', 'commenter', 'document:doc-3', {
      actorId: 'user-3',
      source: 'invite-accept',
    })
  })
})
