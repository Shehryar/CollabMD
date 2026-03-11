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

const mockListNotifications = vi.fn()
vi.mock('@/lib/notification-service', () => ({
  listNotifications: (...args: unknown[]) => mockListNotifications.apply(undefined, args as never),
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

import { GET } from './route'

const fakeSession = {
  user: { id: 'user-1', email: 'test@example.com' },
  session: { activeOrganizationId: 'org-1' },
}

describe('/api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockDbGet.mockReturnValue({ id: 'member-1' })
    mockListNotifications.mockReturnValue({
      notifications: [{ id: 'notif-1', title: 'Title', body: 'Body', read: false }],
      unreadCount: 3,
      nextOffset: '20',
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const res = await GET(new NextRequest('http://localhost:3000/api/notifications'))
    expect(res.status).toBe(401)
  })

  it('returns notifications for the active organization', async () => {
    const res = await GET(
      new NextRequest('http://localhost:3000/api/notifications?limit=20&offset=0'),
    )

    expect(res.status).toBe(200)
    expect(mockListNotifications).toHaveBeenCalledWith({
      userId: 'user-1',
      orgId: 'org-1',
      limit: 20,
      offset: 0,
    })
    expect(res.headers.get('x-collabmd-next-offset')).toBe('20')
    expect(await res.json()).toEqual({
      notifications: [{ id: 'notif-1', title: 'Title', body: 'Body', read: false }],
      unreadCount: 3,
    })
  })

  it('returns an empty payload when no active organization is selected', async () => {
    mockGetSession.mockResolvedValueOnce({
      ...fakeSession,
      session: { activeOrganizationId: null },
    })

    const res = await GET(new NextRequest('http://localhost:3000/api/notifications'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ notifications: [], unreadCount: 0 })
    expect(mockListNotifications).not.toHaveBeenCalled()
  })
})
