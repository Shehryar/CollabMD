import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { checkPermission } from '@collabmd/shared'
import {
  db,
  documentSnapshots,
  users,
  desc,
  eq,
} from '@collabmd/db'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'
import { getSyncHttpUrl } from '@/lib/sync-url'

type RouteParams = { params: Promise<{ id: string }> }

function toSnapshotResponse(row: {
  id: string
  createdAt: Date
  createdBy: string | null
  createdByName: string | null
  isAgentEdit: boolean
  label: string | null
}) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    isAgentEdit: row.isAgentEdit,
    label: row.label,
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id: docId } = await params
  const canView = await checkPermission(session.user.id, 'can_view', 'document', docId)
  if (!canView) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Number.isNaN(rawLimit) ? 50 : Math.max(1, Math.min(rawLimit, 200))

  const rows = db
    .select({
      id: documentSnapshots.id,
      createdAt: documentSnapshots.createdAt,
      createdBy: documentSnapshots.createdBy,
      createdByName: users.name,
      isAgentEdit: documentSnapshots.isAgentEdit,
      label: documentSnapshots.label,
    })
    .from(documentSnapshots)
    .leftJoin(users, eq(documentSnapshots.createdBy, users.id))
    .where(eq(documentSnapshots.documentId, docId))
    .orderBy(desc(documentSnapshots.createdAt))
    .limit(limit)
    .all()

  return NextResponse.json(rows.map(toSnapshotResponse))
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rateLimitError = enforceUserMutationRateLimit(session.user.id, { ip: getClientIp(request) })
  if (rateLimitError) return rateLimitError

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const { id: docId } = await params
  const canEdit = await checkPermission(session.user.id, 'can_edit', 'document', docId)
  if (!canEdit) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await request.json() as { label?: string }
  const syncHttpUrl = getSyncHttpUrl()
  const syncRes = await fetch(`${syncHttpUrl}/snapshot/${encodeURIComponent(docId)}`, {
    method: 'GET',
    cache: 'no-store',
  })

  if (syncRes.status === 404) {
    return NextResponse.json({ error: 'document is not active on sync server' }, { status: 409 })
  }
  if (!syncRes.ok) {
    return NextResponse.json({ error: 'failed to fetch document state' }, { status: 502 })
  }

  const snapshotBuffer = Buffer.from(await syncRes.arrayBuffer())
  if (snapshotBuffer.byteLength === 0) {
    return NextResponse.json({ error: 'snapshot payload is empty' }, { status: 400 })
  }

  const label = body.label?.trim() ? body.label.trim() : null
  const createdAt = new Date()
  const id = crypto.randomUUID()

  db.insert(documentSnapshots).values({
    id,
    documentId: docId,
    snapshot: snapshotBuffer,
    createdAt,
    createdBy: session.user.id,
    isAgentEdit: false,
    label,
  }).run()

  return NextResponse.json({
    id,
    createdAt: createdAt.toISOString(),
    createdBy: session.user.id,
    createdByName: session.user.name ?? session.user.email,
    isAgentEdit: false,
    label,
  }, { status: 201 })
}
