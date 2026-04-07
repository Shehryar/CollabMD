// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

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

const mockEnforceUserMutationRateLimit = vi.fn((..._args: unknown[]): NextResponse | null => null)
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

const mockBuildPendingInviteSignupUrl = vi.fn(() => 'http://localhost:3000/signup?callbackURL=%2F%3Ffolder%3Dfolder-1')
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
const mockInArray = vi.fn((a: unknown, b: unknown) => ({ inArray: [a, b] }))
const mockEq = vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] }))
const mockAnd = vi.fn((...args: unknown[]) => ({ and: args }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockSelectFrom })),
    delete: (...args: unknown[]) => mockDelete.apply(undefined, args as never),
    insert: (...args: unknown[]) => mockInsert.apply(undefined, args as never),
    update: (...args: unknown[]) => mockUpdate.apply(undefined, args as never),
  },
  folders: {
    id: 'id',
    name: 'name',
    orgId: 'org_id',
  },
  users: {
    id: 'id',
    name: 'name',
    email: 'email',
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
  inArray: (...args: unknown[]) => mockInArray.apply(undefined, args as never),
  eq: (...args: unknown[]) => mockEq.apply(undefined, args as never),
  and: (...args: unknown[]) => mockAnd.apply(undefined, args as never),
}))

import { DELETE, GET, POST } from './route'

const fakeSession = {
  user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  session: { id: 'session-1' },
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(
  url: string,
  method: 'POST' | 'DELETE',
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/folders/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(true)
    mockEnforceUserMutationRateLimit.mockReturnValue(null)
    mockRequireJsonContentType.mockReturnValue(null)
    mockReadTuples.mockResolvedValue([])
    mockGet.mockReturnValue(undefined)
    mockAll.mockResolvedValue([])
    mockRun.mockResolvedValue(undefined)
    mockInsertValues.mockResolvedValue(undefined)
    mockCreateAndBroadcastNotification.mockResolvedValue(undefined)
    mockSendShareInviteEmail.mockResolvedValue(undefined)
    mockBuildPendingInviteSignupUrl.mockReturnValue(
      'http://localhost:3000/signup?callbackURL=%2F%3Ffolder%3Dfolder-1',
    )
  })

  describe('POST', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null)
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'POST', {
        userId: 'user-2',
        role: 'viewer',
      })
      const res = await POST(req, makeParams('folder-1'))
      expect(res.status).toBe(401)
    })

    it('writes tuple for valid collaborator role', async () => {
      mockGet
        .mockReturnValueOnce({ name: 'Folder Alpha', orgId: 'org-1' })
        .mockReturnValueOnce({ id: 'user-2', email: 'target@example.com' })

      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'POST', {
        userId: 'user-2',
        role: 'editor',
      })
      const res = await POST(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, pending: false })
      expect(mockWriteTuple).toHaveBeenCalledWith('user:user-2', 'editor', 'folder:folder-1', {
        actorId: 'user-1',
        source: 'folder-share',
      })
      expect(mockCreateAndBroadcastNotification).toHaveBeenCalledWith({
        userId: 'user-2',
        orgId: 'org-1',
        type: 'share_invite',
        title: 'Folder shared with you',
        body: 'Test User shared Folder Alpha with you.',
        resourceId: 'folder-1',
        resourceType: 'folder',
      })
      expect(mockSendShareInviteEmail).toHaveBeenCalledWith({
        to: 'target@example.com',
        inviterName: 'Test User',
        resourceName: 'Folder Alpha',
        resourceType: 'folder',
        resourceId: 'folder-1',
        preference: 'all',
        baseUrl: 'http://localhost:3000',
      })
      expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1')
      expect(mockRequireJsonContentType).toHaveBeenCalledTimes(1)
    })

    it('stores a pending invite for unknown email', async () => {
      const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('invite-1')
      mockGet
        .mockReturnValueOnce({ name: 'Folder Alpha', orgId: 'org-1' })
        .mockReturnValueOnce(undefined)

      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'POST', {
        email: 'NewUser@Example.com',
        role: 'viewer',
      })
      const res = await POST(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        pending: true,
        invitationId: 'invite-1',
        inviteUrl: 'http://localhost:3000/signup?callbackURL=%2F%3Ffolder%3Dfolder-1',
        role: 'viewer',
        emailSent: true,
      })
      expect(mockInsertValues).toHaveBeenCalledWith({
        id: 'invite-1',
        email: 'newuser@example.com',
        resourceType: 'folder',
        resourceId: 'folder-1',
        orgId: 'org-1',
        role: 'viewer',
        inviterId: 'user-1',
        createdAt: expect.any(Number),
      })
      expect(mockSendShareInviteEmail).toHaveBeenCalledWith({
        to: 'newuser@example.com',
        inviterName: 'Test User',
        resourceName: 'Folder Alpha',
        resourceType: 'folder',
        resourceId: 'folder-1',
        preference: 'all',
        baseUrl: 'http://localhost:3000',
        resourceUrlOverride: 'http://localhost:3000/signup?callbackURL=%2F%3Ffolder%3Dfolder-1',
        actionLabel: 'Create account to open folder',
      })
      expect(mockWriteTuple).not.toHaveBeenCalled()

      uuidSpy.mockRestore()
    })

    it('can create a pending invite link without sending email', async () => {
      const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('invite-2')
      mockGet
        .mockReturnValueOnce({ name: 'Folder Alpha', orgId: 'org-1' })
        .mockReturnValueOnce(undefined)

      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'POST', {
        email: 'linkonly@example.com',
        role: 'editor',
        sendEmail: false,
      })
      const res = await POST(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        pending: true,
        invitationId: 'invite-2',
        inviteUrl: 'http://localhost:3000/signup?callbackURL=%2F%3Ffolder%3Dfolder-1',
        role: 'editor',
        emailSent: false,
      })
      expect(mockSendShareInviteEmail).not.toHaveBeenCalled()

      uuidSpy.mockRestore()
    })
  })

  describe('GET', () => {
    it('does not invoke mutation-only guards on GET and returns filtered user collaborators plus pending invites', async () => {
      mockReadTuples.mockResolvedValueOnce([
        { user: 'user:user-2', relation: 'owner', object: 'folder:folder-1' },
        { user: 'user:user-3', relation: 'editor', object: 'folder:folder-1' },
        { user: 'user:user-4', relation: 'viewer', object: 'folder:folder-1' },
        { user: 'org:org-1', relation: 'org', object: 'folder:folder-1' },
      ])
      mockAll
        .mockResolvedValueOnce([
          { id: 'user-2', name: 'Owner User', email: 'owner@example.com' },
          { id: 'user-3', name: 'Editor User', email: 'editor@example.com' },
          { id: 'user-4', name: '', email: 'viewer@example.com' },
        ])
        .mockResolvedValueOnce([
          { id: 'invite-1', email: 'pending@example.com', role: 'viewer' },
        ])

      const req = new NextRequest('http://localhost:3000/api/folders/folder-1/permissions')
      const res = await GET(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([
        {
          userId: 'user-2',
          invitationId: null,
          pending: false,
          name: 'Owner User',
          email: 'owner@example.com',
          role: 'owner',
        },
        {
          userId: 'user-3',
          invitationId: null,
          pending: false,
          name: 'Editor User',
          email: 'editor@example.com',
          role: 'editor',
        },
        {
          userId: 'user-4',
          invitationId: null,
          pending: false,
          name: '',
          email: 'viewer@example.com',
          role: 'viewer',
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
      expect(mockEnforceUserMutationRateLimit).not.toHaveBeenCalled()
      expect(mockRequireJsonContentType).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('adds rate limiting with client IP and deletes tuple for valid role', async () => {
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'DELETE', {
        userId: 'user-2',
        role: 'viewer',
      })
      const res = await DELETE(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(mockEnforceUserMutationRateLimit).toHaveBeenCalledWith('user-1', { ip: '127.0.0.1' })
      expect(mockDeleteTuple).toHaveBeenCalledWith('user:user-2', 'viewer', 'folder:folder-1', {
        actorId: 'user-1',
        source: 'folder-unshare',
      })
    })

    it('removes pending invite by invitation id', async () => {
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'DELETE', {
        invitationId: 'invite-1',
        role: 'viewer',
      })
      const res = await DELETE(req, makeParams('folder-1'))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(mockDelete).toHaveBeenCalled()
      expect(mockDeleteTuple).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid delete role', async () => {
      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'DELETE', {
        userId: 'user-2',
        role: 'owner',
      })
      const res = await DELETE(req, makeParams('folder-1'))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'role must be viewer or editor' })
      expect(mockDeleteTuple).not.toHaveBeenCalled()
    })

    it('returns rate limit response when limiter blocks request', async () => {
      mockEnforceUserMutationRateLimit.mockReturnValueOnce(
        NextResponse.json({ error: 'too many requests' }, { status: 429 }),
      )

      const req = jsonRequest('http://localhost:3000/api/folders/folder-1/permissions', 'DELETE', {
        userId: 'user-2',
        role: 'editor',
      })
      const res = await DELETE(req, makeParams('folder-1'))

      expect(res.status).toBe(429)
      expect(mockDeleteTuple).not.toHaveBeenCalled()
    })
  })
})
