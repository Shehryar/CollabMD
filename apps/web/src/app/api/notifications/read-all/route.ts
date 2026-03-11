import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { and, db, eq, members } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { broadcastNotificationEvent, markAllNotificationsRead } from '@/lib/notification-service'

export async function POST() {
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

  const ids = markAllNotificationsRead({
    userId: session.user.id,
    orgId,
  })

  if (ids.length > 0) {
    await broadcastNotificationEvent({
      userId: session.user.id,
      event: { kind: 'notification.read_all' },
    })
  }

  return NextResponse.json({ ok: true, ids })
}
