import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { checkPermission } from '@collabmd/shared'
import {
  and,
  db,
  documentSnapshots,
  eq,
} from '@collabmd/db'
import { enforceUserMutationRateLimit, getClientIp } from '@/lib/rate-limit'
import { requireJsonContentType } from '@/lib/http'
import { getSyncHttpUrl } from '@/lib/sync-url'

type RouteParams = { params: Promise<{ id: string }> }

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

  const body = await request.json() as { snapshotId?: string }
  if (!body.snapshotId) {
    return NextResponse.json({ error: 'snapshotId is required' }, { status: 400 })
  }

  const targetSnapshot = db
    .select({
      id: documentSnapshots.id,
      snapshot: documentSnapshots.snapshot,
      createdAt: documentSnapshots.createdAt,
    })
    .from(documentSnapshots)
    .where(and(
      eq(documentSnapshots.id, body.snapshotId),
      eq(documentSnapshots.documentId, docId),
    ))
    .get()

  if (!targetSnapshot) {
    return NextResponse.json({ error: 'snapshot not found' }, { status: 404 })
  }

  const syncHttpUrl = getSyncHttpUrl()

  const currentStateRes = await fetch(`${syncHttpUrl}/snapshot/${encodeURIComponent(docId)}`, {
    method: 'GET',
    cache: 'no-store',
  })

  if (currentStateRes.status === 404) {
    return NextResponse.json({ error: 'document is not active on sync server' }, { status: 409 })
  }
  if (!currentStateRes.ok) {
    return NextResponse.json({ error: 'failed to fetch current document state' }, { status: 502 })
  }

  const currentStateBuffer = Buffer.from(await currentStateRes.arrayBuffer())
  const targetTimestamp = targetSnapshot.createdAt.toISOString()
  const beforeRevertLabel = `Before revert to ${targetTimestamp}`
  const revertedLabel = `Reverted to ${targetTimestamp}`
  const now = new Date()

  db.insert(documentSnapshots).values({
    id: crypto.randomUUID(),
    documentId: docId,
    snapshot: currentStateBuffer,
    createdAt: now,
    createdBy: session.user.id,
    isAgentEdit: false,
    label: beforeRevertLabel,
  }).run()

  const replaceRes = await fetch(`${syncHttpUrl}/replace/${encodeURIComponent(docId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: new Blob([new Uint8Array(targetSnapshot.snapshot)], { type: 'application/octet-stream' }),
  })

  if (!replaceRes.ok) {
    return NextResponse.json({ error: 'failed to replace document state' }, { status: 502 })
  }

  db.insert(documentSnapshots).values({
    id: crypto.randomUUID(),
    documentId: docId,
    snapshot: targetSnapshot.snapshot,
    createdAt: new Date(),
    createdBy: session.user.id,
    isAgentEdit: false,
    label: revertedLabel,
  }).run()

  return NextResponse.json({ ok: true })
}
