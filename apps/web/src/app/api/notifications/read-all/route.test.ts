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

const mockMarkAllNotificationsRead = vi.fn()
const mockBroadcastNotificationEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notification-service', () => ({
  markAllNotificationsRead: (...args: unknown[]) =>
    mockMarkAllNotificationsRead.apply(undefined, args as never),
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

import { POST } from './route'

const fakeSession = {
  user: { id: 'user-1', email: 'test@example.com' },
  session: { activeOrganizationId: 'org-1' },
}

describe('/api/notifications/read-all', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockDbGet.mockReturnValue({ id: 'member-1' })
    mockMarkAllNotificationsRead.mockReturnValue(['notif-1', 'notif-2'])
  })

  it('marks all notifications as read and broadcasts the change', async () => {
    const res = await POST()

    expect(res.status).toBe(200)
    expect(mockMarkAllNotificationsRead).toHaveBeenCalledWith({
      userId: 'user-1',
      orgId: 'org-1',
    })
    expect(mockBroadcastNotificationEvent).toHaveBeenCalledWith({
      userId: 'user-1',
      event: { kind: 'notification.read_all' },
    })
    expect(await res.json()).toEqual({ ok: true, ids: ['notif-1', 'notif-2'] })
  })

  it('skips realtime broadcast when there is nothing new to mark read', async () => {
    mockMarkAllNotificationsRead.mockReturnValueOnce([])

    const res = await POST()

    expect(res.status).toBe(200)
    expect(mockBroadcastNotificationEvent).not.toHaveBeenCalled()
  })
})
