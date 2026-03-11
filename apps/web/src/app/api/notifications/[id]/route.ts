import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { and, db, eq, members } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { broadcastNotificationEvent, markNotificationRead } from '@/lib/notification-service'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(_request: Request, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const membership = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()
  if (!membership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id } = await params
  const notification = markNotificationRead({
    id,
    userId: session.user.id,
    orgId,
  })
  if (!notification) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  await broadcastNotificationEvent({
    userId: session.user.id,
    event: { kind: 'notification.read', ids: [id] },
  })

  return NextResponse.json(notification)
}
