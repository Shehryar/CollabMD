// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) },
  },
}))

const mockCheckPermission = vi.fn()
const mockWriteTuple = vi.fn()
const mockDeleteTuple = vi.fn()
const mockReadTuples = vi.fn()
vi.mock('@collabmd/shared', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission.apply(undefined, args as never),
  writeTuple: (...args: unknown[]) => mockWriteTuple.apply(undefined, args as never),
  deleteTuple: (...args: unknown[]) => mockDeleteTuple.apply(undefined, args as never),
  readTuples: (...args: unknown[]) => mockReadTuples.apply(undefined, args as never),
}))

const mockEnforceUserMutationRateLimit = vi.fn(() => null)
const mockGetClientIp = vi.fn(() => '127.0.0.1')
vi.mock('@/lib/rate-limit', () => ({
  enforceUserMutationRateLimit: (...args: unknown[]) =>
    mockEnforceUserMutationRateLimit.apply(undefined, args as never),
  getClientIp: (...args: unknown[]) => mockGetClientIp.apply(undefined, args as never),
}))

const mockRequireJsonContentType = vi.fn(() => null)
vi.mock('@/lib/http', () => ({
  requireJsonContentType: (...args: unknown[]) =>
    mockRequireJsonContentType.apply(undefined, args as never),
}))

const mockCreateAndBroadcastNotification = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notification-service', () => ({
  createAndBroadcastNotification: (...args: unknown[]) =>
    mockCreateAndBroadcastNotification.apply(undefined, args as never),
}))

const mockSendShareInviteEmail = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notification-email-service', () => ({
  sendShareInviteEmail: (...args: unknown[]) => mockSendShareInviteEmail.apply(undefined, args as never),
}))

const mockBuildPendingInviteSignupUrl = vi.fn(() => 'http://localhost:3000/signup?callbackURL=%2Fdoc%2Fdoc-1')
vi.mock('@/lib/pending-resource-invites', () => ({
  buildPendingInviteSignupUrl: (...args: unknown[]) =>
    mockBuildPendingInviteSignupUrl.apply(undefined, args as never),
}))

const mockGet = vi.fn()
const mockAll = vi.fn()
const mockRun = vi.fn()
const mockInsertValues = vi.fn()
const mockDeleteWhere = vi.fn(() => ({ run: mockRun }))
const mockUpdateSetWhere = vi.fn(() => ({ run: mockRun }))

const mockSelectFrom = vi.fn(() => ({
  where: vi.fn(() => ({
    get: mockGet,
    all: mockAll,
  })),
}))

const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }))
const mockInsert = vi.fn(() => ({ values: mockInsertValues }))
const mockUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: mockUpdateSetWhere })) }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
const mockAnd = vi.fn((...args: unknown[]) => ({ and: args }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockSelectFrom })),
    delete: (...args: unknown[]) => mockDelete.apply(undefined, args as never),
    insert: (...args: unknown[]) => mockInsert.apply(undefined, args as never),
    update: (...args: unknown[]) => mockUpdate.apply(undefined, args as never),
  },
  users: {
    id: 'id',
    email: 'email',
    name: 'name',
  },
  documents: {
    id: 'id',
    title: 'title',
    orgId: 'org_id',
  },
  pendingResourceInvites: {
    id: 'id',
    email: 'email',
    resourceType: 'resource_type',
    resourceId: 'resource_id',
    role: 'role',
    orgId: 'org_id',
    inviterId: 'inviter_id',
  },
  getUserEmailNotificationPreferenceAsync: vi.fn(() => 'all'),
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
  and: (...args: unknown[]) => mockAnd.apply(undefined, args as never),
}))

import { DELETE, GET, PATCH, POST } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/documents/[id]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)
    mockGet.mockReturnValue(undefined)
    mockAll.mockResolvedValue([])
    mockRun.mockResolvedValue(undefined)
    mockInsertValues.mockResolvedValue(undefined)
    mockReadTuples.mockResolvedValue([])
    mockCreateAndBroadcastNotification.mockResolvedValue(undefined)
    mockSendShareInviteEmail.mockResolvedValue(undefined)
    mockBuildPendingInviteSignupUrl.mockReturnValue(
      'http://localhost:3000/signup?callbackURL=%2Fdoc%2Fdoc-1',
    )
  })

  describe('POST', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null)

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'POST', {
        email: 'target@example.com',
        role: 'viewer',
      })
      const res = await POST(req, makeParams('doc-1'))

      expect(res.status).toBe(401)
    })

    it('writes share tuple for valid collaborator', async () => {
      mockGet
        .mockReturnValueOnce({
          id: 'user-2',
          email: 'target@example.com',
          name: 'Target User',
        })
        .mockReturnValueOnce({
          title: 'Shared Doc',
          orgId: 'org-1',
        })

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'POST', {
        email: 'target@example.com',
        role: 'commenter',
      })
      const res = await POST(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.pending).toBe(false)
      expect(body.userId).toBe('user-2')
      expect(body.role).toBe('commenter')

      expect(mockCheckPermission).toHaveBeenCalledWith('user-1', 'can_edit', 'document', 'doc-1')
      expect(mockWriteTuple).toHaveBeenCalledWith('user:user-2', 'commenter', 'document:doc-1', {
        actorId: 'user-1',
        source: 'document-share',
      })
      expect(mockCreateAndBroadcastNotification).toHaveBeenCalledWith({
        userId: 'user-2',
        orgId: 'org-1',
        type: 'share_invite',
        title: 'Document shared with you',
        body: 'Test User shared Shared Doc with you.',
        resourceId: 'doc-1',
        resourceType: 'document',
      })
      expect(mockSendShareInviteEmail).toHaveBeenCalledWith({
        to: 'target@example.com',
        inviterName: 'Test User',
        resourceName: 'Shared Doc',
        resourceType: 'document',
        resourceId: 'doc-1',
        preference: 'all',
        baseUrl: 'http://localhost:3000',
      })
      expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1', { ip: '127.0.0.1' })
    })

    it('stores a pending invite when the user does not exist yet', async () => {
      const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('invite-1')
      mockGet
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({
          title: 'Shared Doc',
          orgId: 'org-1',
        })

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'POST', {
        email: 'NewUser@Example.com',
        role: 'editor',
      })
      const res = await POST(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        pending: true,
        invitationId: 'invite-1',
        inviteUrl: 'http://localhost:3000/signup?callbackURL=%2Fdoc%2Fdoc-1',
        role: 'editor',
        emailSent: true,
      })

      expect(mockDelete).toHaveBeenCalled()
      expect(mockInsertValues).toHaveBeenCalledWith({
        id: 'invite-1',
        email: 'newuser@example.com',
        resourceType: 'document',
        resourceId: 'doc-1',
        orgId: 'org-1',
        role: 'editor',
        inviterId: 'user-1',
        createdAt: expect.any(Number),
      })
      expect(mockBuildPendingInviteSignupUrl).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:3000',
        resourceType: 'document',
        resourceId: 'doc-1',
      })
      expect(mockSendShareInviteEmail).toHaveBeenCalledWith({
        to: 'newuser@example.com',
        inviterName: 'Test User',
        resourceName: 'Shared Doc',
        resourceType: 'document',
        resourceId: 'doc-1',
        preference: 'all',
        baseUrl: 'http://localhost:3000',
        resourceUrlOverride: 'http://localhost:3000/signup?callbackURL=%2Fdoc%2Fdoc-1',
        actionLabel: 'Create account to open document',
      })
      expect(mockWriteTuple).not.toHaveBeenCalled()
      expect(mockCreateAndBroadcastNotification).not.toHaveBeenCalled()

      uuidSpy.mockRestore()
    })

    it('can create a pending invite link without sending email', async () => {
      const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('invite-2')
      mockGet
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({
          title: 'Shared Doc',
          orgId: 'org-1',
        })

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'POST', {
        email: 'linkonly@example.com',
        role: 'viewer',
        sendEmail: false,
      })
      const res = await POST(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        pending: true,
        invitationId: 'invite-2',
        inviteUrl: 'http://localhost:3000/signup?callbackURL=%2Fdoc%2Fdoc-1',
        role: 'viewer',
        emailSent: false,
      })
      expect(mockSendShareInviteEmail).not.toHaveBeenCalled()

      uuidSpy.mockRestore()
    })
  })

  describe('GET', () => {
    it('lists collaborator tuples with user details and pending invites', async () => {
      mockReadTuples.mockResolvedValueOnce([
        { user: 'user:user-2', relation: 'editor', object: 'document:doc-1' },
        { user: 'org:org-1', relation: 'org', object: 'document:doc-1' },
      ])
      mockGet.mockReturnValueOnce({ id: 'user-2', name: 'Alice', email: 'alice@example.com' })
      mockAll.mockResolvedValueOnce([
        {
          id: 'invite-1',
          email: 'pending@example.com',
          role: 'viewer',
        },
      ])

      const req = new NextRequest('http://localhost:3000/api/documents/doc-1/share')
      const res = await GET(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        {
          userId: 'user-2',
          invitationId: null,
          pending: false,
          name: 'Alice',
          email: 'alice@example.com',
          role: 'editor',
        },
        {
          userId: null,
          invitationId: 'invite-1',
          pending: true,
          name: '',
          email: 'pending@example.com',
          role: 'viewer',
        },
      ])
    })
  })

  describe('PATCH', () => {
    it('updates collaborator role when requester can edit and target is not owner', async () => {
      mockCheckPermission
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'PATCH', {
        userId: 'user-2',
        oldRole: 'viewer',
        newRole: 'editor',
      })
      const res = await PATCH(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(mockDeleteTuple).toHaveBeenCalledWith('user:user-2', 'viewer', 'document:doc-1', {
        actorId: 'user-1',
        source: 'document-share',
      })
      expect(mockWriteTuple).toHaveBeenCalledWith('user:user-2', 'editor', 'document:doc-1', {
        actorId: 'user-1',
        source: 'document-share',
      })
    })

    it('updates pending invite role by invitation id', async () => {
      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'PATCH', {
        invitationId: 'invite-1',
        oldRole: 'viewer',
        newRole: 'commenter',
      })
      const res = await PATCH(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(mockUpdate).toHaveBeenCalled()
      expect(mockDeleteTuple).not.toHaveBeenCalled()
      expect(mockWriteTuple).not.toHaveBeenCalled()
    })

    it('rejects role changes for the owner', async () => {
      mockCheckPermission
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)

      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'PATCH', {
        userId: 'user-2',
        oldRole: 'editor',
        newRole: 'viewer',
      })
      const res = await PATCH(req, makeParams('doc-1'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'cannot change owner role' })
      expect(mockDeleteTuple).not.toHaveBeenCalled()
      expect(mockWriteTuple).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('removes collaborator tuple for valid role', async () => {
      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'DELETE', {
        userId: 'user-2',
        role: 'commenter',
      })
      const res = await DELETE(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(mockDeleteTuple).toHaveBeenCalledWith('user:user-2', 'commenter', 'document:doc-1', {
        actorId: 'user-1',
        source: 'document-unshare',
      })
    })

    it('removes pending invite by invitation id', async () => {
      const req = jsonRequest('http://localhost:3000/api/documents/doc-1/share', 'DELETE', {
        invitationId: 'invite-1',
        role: 'viewer',
      })
      const res = await DELETE(req, makeParams('doc-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(mockDelete).toHaveBeenCalled()
      expect(mockDeleteTuple).not.toHaveBeenCalled()
    })
  })
})
