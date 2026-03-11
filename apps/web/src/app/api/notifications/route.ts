import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { and, db, eq, members } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { listNotifications } from '@/lib/notification-service'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    return NextResponse.json(
      { notifications: [], unreadCount: 0 },
      { headers: { 'x-collabmd-next-offset': '' } },
    )
  }

  const membership = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()
  if (!membership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parsePositiveInt(request.nextUrl.searchParams.get('limit'), DEFAULT_PAGE_SIZE)),
  )
  const offset = parsePositiveInt(request.nextUrl.searchParams.get('offset'), 0)
  const result = listNotifications({
    userId: session.user.id,
    orgId,
    limit,
    offset,
  })

  return NextResponse.json(
    {
      notifications: result.notifications,
      unreadCount: result.unreadCount,
    },
    {
      headers: {
        'x-collabmd-next-offset': result.nextOffset,
      },
    },
  )
}
