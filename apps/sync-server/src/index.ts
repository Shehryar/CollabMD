import { createSyncServer } from './server.js'
import { verifyToken, verifySessionCookie } from './auth.js'
import { checkPermission } from '@collabmd/shared'
import crypto from 'node:crypto'
import { db, documentSnapshots } from '@collabmd/db'

const PORT = parseInt(process.env.PORT ?? '4444', 10)
const SNAPSHOT_INTERVAL_MS = parseInt(process.env.SNAPSHOT_INTERVAL_MS ?? '300000', 10)

const { server } = createSyncServer({
  auth: process.env.BETTER_AUTH_URL ? {
    verifyToken,
    verifySessionCookie,
    checkPermission,
  } : undefined,
  snapshotIntervalMs: Number.isFinite(SNAPSHOT_INTERVAL_MS) && SNAPSHOT_INTERVAL_MS > 0
    ? SNAPSHOT_INTERVAL_MS
    : 300_000,
  snapshotCallback: async (docId, snapshot, lastEditUserId, lastEditSource) => {
    db.insert(documentSnapshots).values({
      id: crypto.randomUUID(),
      documentId: docId,
      snapshot: Buffer.from(snapshot),
      createdAt: new Date(),
      createdBy: lastEditUserId,
      isAgentEdit: lastEditSource === 'daemon',
      label: null,
    }).run()
  },
})

server.listen(PORT, () => {
  console.log(`sync-server listening on port ${PORT}`)
})
