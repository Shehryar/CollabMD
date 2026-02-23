// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as Y from 'yjs'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) } },
}))

const mockCheckPermission = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
}))

const mockSelectGet = vi.fn()
const mockWhereSelect = vi.fn(() => ({ get: mockSelectGet }))
const mockLeftJoin = vi.fn(() => ({ where: mockWhereSelect }))
const mockFrom = vi.fn(() => ({ leftJoin: mockLeftJoin }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
const mockAnd = vi.fn((...args: unknown[]) => ({ and: args }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  documentSnapshots: {
    id: 'id',
    documentId: 'document_id',
    snapshot: 'snapshot',
    createdAt: 'created_at',
    createdBy: 'created_by',
    isAgentEdit: 'is_agent_edit',
    label: 'label',
  },
  users: {
    id: 'id',
    name: 'name',
  },
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
  and: (...args: unknown[]) => mockAnd.apply(undefined, args as never),
}))

import { GET } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1', activeOrganizationId: 'org-1' },
}

function makeParams(id: string, snapshotId: string): { params: Promise<{ id: string; snapshotId: string }> } {
  return { params: Promise.resolve({ id, snapshotId }) }
}

describe('/api/documents/[id]/snapshots/[snapshotId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
  })

  it('GET returns snapshot metadata + decoded text content', async () => {
    const tempDoc = new Y.Doc()
    tempDoc.getText('codemirror').insert(0, '# Hello history')
    const update = Y.encodeStateAsUpdate(tempDoc)
    tempDoc.destroy()

    mockSelectGet.mockReturnValueOnce({
      id: 'snap-1',
      snapshot: Buffer.from(update),
      createdAt: new Date('2026-02-10T10:00:00.000Z'),
      createdBy: 'user-1',
      createdByName: 'Test User',
      isAgentEdit: false,
      label: 'checkpoint',
    })

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/snapshots/snap-1')
    const res = await GET(req, makeParams('doc-1', 'snap-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      id: 'snap-1',
      createdAt: '2026-02-10T10:00:00.000Z',
      createdBy: 'user-1',
      createdByName: 'Test User',
      isAgentEdit: false,
      label: 'checkpoint',
      content: '# Hello history',
    })
  })

  it('GET returns 404 for nonexistent snapshot', async () => {
    mockSelectGet.mockReturnValueOnce(undefined)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/snapshots/missing')
    const res = await GET(req, makeParams('doc-1', 'missing'))

    expect(res.status).toBe(404)
  })

  it('GET returns 403 when user lacks can_view', async () => {
    mockCheckPermission.mockResolvedValueOnce(false)

    const req = new NextRequest('http://localhost:3000/api/documents/doc-1/snapshots/snap-1')
    const res = await GET(req, makeParams('doc-1', 'snap-1'))

    expect(res.status).toBe(403)
    expect(mockSelectGet).not.toHaveBeenCalled()
  })
})
