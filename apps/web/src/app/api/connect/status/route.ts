import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { and, db, documents, eq, inArray, isNull, members } from '@collabmd/db'
import { auth } from '@/lib/auth'
import { getSyncHttpUrl } from '@/lib/sync-url'

interface SyncConnection {
  docId: string
  userId: string
  source: string
}

async function fetchDaemonConnections(): Promise<SyncConnection[]> {
  const syncHttpUrl = getSyncHttpUrl()

  try {
    const res = await fetch(`${syncHttpUrl}/connections`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data as SyncConnection[]
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cliAuthenticated = request.cookies.get('collabmd_cli_authenticated')?.value === '1'
  const orgId = request.nextUrl.searchParams.get('orgId') ?? session.session.activeOrganizationId
  if (!orgId) {
    return NextResponse.json({ cliAuthenticated, daemonConnected: false })
  }

  const membership = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()

  if (!membership) {
    return NextResponse.json({ error: 'not a member of this organization' }, { status: 403 })
  }

  const daemonConnections = await fetchDaemonConnections()
  const connectedDocIds = Array.from(new Set(
    daemonConnections
      .filter((conn) => conn.source === 'daemon' && conn.userId === session.user.id)
      .map((conn) => conn.docId),
  ))

  const connectedDoc = connectedDocIds.length > 0
    ? db
      .select({ id: documents.id })
      .from(documents)
      .where(and(
        eq(documents.orgId, orgId),
        inArray(documents.id, connectedDocIds),
        isNull(documents.deletedAt),
      ))
      .get()
    : null

  return NextResponse.json({
    cliAuthenticated,
    daemonConnected: Boolean(connectedDoc),
  })
}
