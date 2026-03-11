// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: {
    api: { getSession: (...args: unknown[]) => mockGetSession.apply(undefined, args as never) },
  },
}))

const mockMarkNotificationRead = vi.fn()
const mockBroadcastNotificationEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notification-service', () => ({
  markNotificationRead: (...args: unknown[]) =>
    mockMarkNotificationRead.apply(undefined, args as never),
  broadcastNotificationEvent: (...args: unknown[]) =>
    mockBroadcastNotificationEvent.apply(undefined, args as never),
}))

const mockDbGet = vi.fn()
const mockWhere = vi.fn(() => ({ get: mockDbGet }))
const mockFrom = vi.fn(() => ({ where: mockWhere }))

vi.mock('@collabmd/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
  members: {
    id: 'id',
    organizationId: 'organization_id',
    userId: 'user_id',
  },
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}))

import { PATCH } from './route'

const fakeSession = {
  user: { id: 'user-1', email: 'test@example.com' },
  session: { activeOrganizationId: 'org-1' },
}

describe('/api/notifications/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockDbGet.mockReturnValue({ id: 'member-1' })
    mockMarkNotificationRead.mockReturnValue({
      id: 'notif-1',
      read: true,
    })
  })

  it('marks a notification as read and broadcasts the update', async () => {
    const res = await PATCH(new Request('http://localhost:3000/api/notifications/notif-1'), {
      params: Promise.resolve({ id: 'notif-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockMarkNotificationRead).toHaveBeenCalledWith({
      id: 'notif-1',
      userId: 'user-1',
      orgId: 'org-1',
    })
    expect(mockBroadcastNotificationEvent).toHaveBeenCalledWith({
      userId: 'user-1',
      event: { kind: 'notification.read', ids: ['notif-1'] },
    })
  })

  it('returns 404 when the notification is missing', async () => {
    mockMarkNotificationRead.mockReturnValueOnce(null)

    const res = await PATCH(new Request('http://localhost:3000/api/notifications/notif-2'), {
      params: Promise.resolve({ id: 'notif-2' }),
    })

    expect(res.status).toBe(404)
    expect(mockBroadcastNotificationEvent).not.toHaveBeenCalled()
  })
})
