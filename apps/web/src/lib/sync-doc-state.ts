import { NextResponse } from 'next/server'
import * as Y from 'yjs'
import { getSyncHttpUrl } from '@/lib/sync-url'

export async function fetchDocFromSyncServer(docId: string): Promise<{
  ydoc: Y.Doc
} | {
  error: NextResponse
}> {
  const syncHttpUrl = getSyncHttpUrl()
  const response = await fetch(`${syncHttpUrl}/snapshot/${encodeURIComponent(docId)}`, {
    method: 'GET',
    cache: 'no-store',
  })

  if (response.status === 404) {
    return {
      error: NextResponse.json({ error: 'document is not active on sync server' }, { status: 409 }),
    }
  }
  if (!response.ok) {
    return {
      error: NextResponse.json({ error: 'failed to fetch document state' }, { status: 502 }),
    }
  }

  const update = new Uint8Array(await response.arrayBuffer())
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, update)
  return { ydoc }
}

export async function replaceDocOnSyncServer(docId: string, ydoc: Y.Doc): Promise<NextResponse | null> {
  const update = Y.encodeStateAsUpdate(ydoc)
  const syncHttpUrl = getSyncHttpUrl()
  const response = await fetch(`${syncHttpUrl}/replace/${encodeURIComponent(docId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(update),
  })

  if (!response.ok) {
    return NextResponse.json({ error: 'failed to replace document state' }, { status: 502 })
  }

  return null
}
