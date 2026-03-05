import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { and, db, documents, eq, folders, inArray, isNull, members } from '@collabmd/db'
import { getSyncHttpUrl } from '@/lib/sync-url'

interface SyncConnection {
  docId: string
  userId: string
  source: string
}

interface ConnectedFolder {
  folderId: string | null
  folderName: string
  status: 'synced' | 'syncing' | 'disconnected'
  fileCount: number
  lastSync: string
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

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    return NextResponse.json([])
  }

  const membership = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, session.user.id)))
    .get()
  if (!membership) {
    return NextResponse.json({ error: 'not a member of this organization' }, { status: 403 })
  }

  const allConnections = await fetchDaemonConnections()
  const activeDocIds = new Set(
    allConnections
      .filter((conn) => conn.source === 'daemon' && conn.userId === session.user.id)
      .map((conn) => conn.docId),
  )

  const daemonDocs = db
    .select({
      id: documents.id,
      folderId: documents.folderId,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.ownerId, session.user.id),
        eq(documents.source, 'daemon'),
        isNull(documents.deletedAt),
      ),
    )
    .all()

  if (daemonDocs.length === 0) {
    return NextResponse.json([])
  }

  const folderIds = Array.from(
    new Set(daemonDocs.map((doc) => doc.folderId).filter((id): id is string => id !== null)),
  )
  const folderRows =
    folderIds.length > 0
      ? db
          .select({ id: folders.id, name: folders.name })
          .from(folders)
          .where(inArray(folders.id, folderIds))
          .all()
      : []
  const folderNameById = new Map(folderRows.map((folder) => [folder.id, folder.name]))

  const aggregate = new Map<
    string,
    {
      folderId: string | null
      fileCount: number
      lastSyncMs: number
      hasActiveConnection: boolean
    }
  >()

  for (const doc of daemonDocs) {
    const key = doc.folderId ?? '__root__'
    const current = aggregate.get(key) ?? {
      folderId: doc.folderId,
      fileCount: 0,
      lastSyncMs: 0,
      hasActiveConnection: false,
    }
    const updatedAtMs = new Date(doc.updatedAt).getTime()
    current.fileCount += 1
    current.lastSyncMs = Math.max(current.lastSyncMs, updatedAtMs)
    if (activeDocIds.has(doc.id)) {
      current.hasActiveConnection = true
    }
    aggregate.set(key, current)
  }

  const now = Date.now()
  const SYNCING_THRESHOLD_MS = 10_000

  const connectedFolders: ConnectedFolder[] = Array.from(aggregate.values()).map((entry) => {
    let status: ConnectedFolder['status'] = 'disconnected'
    if (entry.hasActiveConnection) {
      const recency = now - entry.lastSyncMs
      status = recency < SYNCING_THRESHOLD_MS ? 'syncing' : 'synced'
    }
    return {
      folderId: entry.folderId,
      folderName:
        entry.folderId === null ? 'Root' : (folderNameById.get(entry.folderId) ?? 'Unknown folder'),
      status,
      fileCount: entry.fileCount,
      lastSync: new Date(entry.lastSyncMs || Date.now()).toISOString(),
    }
  })

  connectedFolders.sort((a, b) => a.folderName.localeCompare(b.folderName))
  return NextResponse.json(connectedFolders)
}
