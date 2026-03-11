import http from 'node:http'
import { createHash } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { NotificationRealtimeEvent } from '@collabmd/shared'
import type { TokenPayload } from './auth.js'

const messageSync = 0
const messageAwareness = 1
const messageNotification = 4
const NOTIFICATION_ROOM_PREFIX = '__notifications__:'

function isNotificationRoomName(name: string): boolean {
  return name.startsWith(NOTIFICATION_ROOM_PREFIX)
}

function getNotificationRoomUserId(name: string): string | null {
  if (!isNotificationRoomName(name)) return null
  const userId = name.slice(NOTIFICATION_ROOM_PREFIX.length).trim()
  return userId || null
}

// Room-per-document: each room holds a shared Y.Doc and awareness state
interface Room {
  name: string
  kind: 'document' | 'notification'
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
  syncListeners: Map<WebSocket, (update: Uint8Array, origin: unknown) => void>
  lastEditAt: number | null
  lastEditUserId: string | null
  lastEditSource: 'browser' | 'daemon' | null
  snapshotTimer: NodeJS.Timeout | null
  lastSnapshotHash: string | null
  hydratePromise: Promise<void> | null
  hydrated: boolean
}

interface ConnMeta {
  source?: 'browser' | 'daemon'
  userId?: string
  canEdit?: boolean
}

type SyncEventType =
  | 'document.edited'
  | 'comment.created'
  | 'comment.replied'
  | 'comment.mention'
  | 'suggestion.created'
  | 'suggestion.accepted'
  | 'suggestion.dismissed'
  | 'discussion.created'

export interface SyncServerConfig {
  auth?: {
    verifyToken: (token: string) => Promise<TokenPayload | null>
    verifySessionCookie?: (cookieHeader: string) => Promise<TokenPayload | null>
    checkPermission: (
      userId: string,
      relation: string,
      objectType: string,
      objectId: string,
    ) => Promise<boolean>
  }
  checkAgentPolicy?: (
    docId: string,
    source: string,
  ) => Promise<{ allowed: boolean; code?: number; reason?: string }>
  snapshotCallback?: (
    docId: string,
    snapshot: Uint8Array,
    lastEditUserId: string | null,
    lastEditSource: 'browser' | 'daemon' | null,
  ) => Promise<void>
  snapshotLoader?: (docId: string) => Promise<Uint8Array | null>
  eventCallback?: (event: {
    eventType: SyncEventType
    documentId: string
    actorId: string | null
    actorSource: 'browser' | 'daemon' | null
    timestamp: string
    data?: Record<string, unknown>
  }) => Promise<void>
  snapshotIntervalMs?: number
}

const MAX_CONNECTIONS_PER_USER = 20

export function createSyncServer(config?: SyncServerConfig) {
  const rooms = new Map<string, Room>()
  const snapshotIntervalMs = config?.snapshotIntervalMs ?? 300_000
  // Track active WebSocket connections per user for rate limiting
  const userConnections = new Map<string, Set<WebSocket>>()
  const notificationConnections = new Map<string, Set<WebSocket>>()
  // Track connection metadata (source, userId)
  const connMeta = new Map<WebSocket, ConnMeta>()

  function hashSnapshot(snapshot: Uint8Array): string {
    return createHash('sha256').update(snapshot).digest('hex')
  }

  function clearSnapshotTimer(room: Room) {
    if (room.snapshotTimer) {
      clearTimeout(room.snapshotTimer)
      room.snapshotTimer = null
    }
  }

  function extractMentionedAgents(value: string): string[] {
    const mentions = new Set<string>()
    const matches = value.matchAll(/@([a-zA-Z0-9_-]+)/g)
    for (const match of matches) {
      const name = (match[1] ?? '').trim()
      if (!name) continue
      mentions.add(name)
    }
    return Array.from(mentions)
  }

  function captureDocEventState(doc: Y.Doc): {
    commentIds: Set<string>
    commentsById: Map<string, { authorId: string; text: string }>
    replySignatures: Map<
      string,
      {
        commentId: string
        commentAuthorId: string
        replyAuthorId: string
        text: string
      }
    >
    mentionSignatures: Set<string>
    suggestionIds: Set<string>
    suggestionStatusByCommentId: Map<string, 'pending' | 'accepted' | 'dismissed'>
    discussionIds: Set<string>
  } {
    const commentIds = new Set<string>()
    const commentsById = new Map<string, { authorId: string; text: string }>()
    const replySignatures = new Map<
      string,
      {
        commentId: string
        commentAuthorId: string
        replyAuthorId: string
        text: string
      }
    >()
    const mentionSignatures = new Set<string>()
    const suggestionIds = new Set<string>()
    const suggestionStatusByCommentId = new Map<string, 'pending' | 'accepted' | 'dismissed'>()
    const discussionIds = new Set<string>()

    const ycomments = doc.getArray<Y.Map<unknown>>('comments')
    for (const comment of ycomments.toArray()) {
      if (!(comment instanceof Y.Map)) continue
      const id = typeof comment.get('id') === 'string' ? (comment.get('id') as string) : ''
      const text = typeof comment.get('text') === 'string' ? (comment.get('text') as string) : ''
      if (!id) continue

      commentIds.add(id)
      commentsById.set(id, {
        authorId:
          typeof comment.get('authorId') === 'string' ? (comment.get('authorId') as string) : '',
        text,
      })
      for (const agent of extractMentionedAgents(text)) {
        mentionSignatures.add(`${id}\u0000${agent}`)
      }

      const thread = comment.get('thread')
      if (thread instanceof Y.Array) {
        for (const entry of thread.toArray()) {
          if (!(entry instanceof Y.Map)) continue
          const replyText =
            typeof entry.get('text') === 'string' ? (entry.get('text') as string).trim() : ''
          if (!replyText) continue
          const replyAuthorId =
            typeof entry.get('authorId') === 'string' ? (entry.get('authorId') as string) : ''
          const replyCreatedAt =
            typeof entry.get('createdAt') === 'string' ? (entry.get('createdAt') as string) : ''
          const signature = `${id}\u0000${replyAuthorId}\u0000${replyCreatedAt}\u0000${replyText}`
          replySignatures.set(signature, {
            commentId: id,
            commentAuthorId:
              typeof comment.get('authorId') === 'string'
                ? (comment.get('authorId') as string)
                : '',
            replyAuthorId,
            text: replyText,
          })
        }
      }

      const suggestion = comment.get('suggestion')
      if (!(suggestion instanceof Y.Map)) continue
      suggestionIds.add(id)
      const raw = suggestion.get('status')
      const status = raw === 'accepted' || raw === 'dismissed' ? raw : 'pending'
      suggestionStatusByCommentId.set(id, status)
    }

    const ydiscussions = doc.getArray<Y.Map<unknown>>('discussions')
    for (const discussion of ydiscussions.toArray()) {
      if (!(discussion instanceof Y.Map)) continue
      const id = typeof discussion.get('id') === 'string' ? (discussion.get('id') as string) : ''
      if (!id) continue
      discussionIds.add(id)
    }

    return {
      commentIds,
      commentsById,
      replySignatures,
      mentionSignatures,
      suggestionIds,
      suggestionStatusByCommentId,
      discussionIds,
    }
  }

  function encodeNotificationEvent(event: NotificationRealtimeEvent): Uint8Array {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageNotification)
    encoding.writeVarString(encoder, JSON.stringify(event))
    return encoding.toUint8Array(encoder)
  }

  function pushNotificationToUser(userId: string, event: NotificationRealtimeEvent): void {
    const conns = notificationConnections.get(userId)
    if (!conns || conns.size === 0) return

    const payload = encodeNotificationEvent(event)
    for (const ws of conns) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload)
      }
    }
  }

  function emitEvent(event: {
    eventType: SyncEventType
    documentId: string
    actorId: string | null
    actorSource: 'browser' | 'daemon' | null
    timestamp: string
    data?: Record<string, unknown>
  }): void {
    if (!config?.eventCallback) return
    void config.eventCallback(event).catch(() => {
      // Best-effort event dispatch.
    })
  }

  async function maybePersistSnapshot(room: Room): Promise<void> {
    if (room.kind !== 'document') return
    if (!config?.snapshotCallback) return
    if (room.lastEditAt === null) return
    if (room.doc.store.clients.size === 0) return

    const snapshot = Y.encodeStateAsUpdate(room.doc)
    if (snapshot.byteLength === 0) return

    const snapshotHash = hashSnapshot(snapshot)
    if (snapshotHash === room.lastSnapshotHash) return

    await config.snapshotCallback(room.name, snapshot, room.lastEditUserId, room.lastEditSource)
    room.lastSnapshotHash = snapshotHash
  }

  function scheduleSnapshot(room: Room) {
    clearSnapshotTimer(room)
    room.snapshotTimer = setTimeout(() => {
      void maybePersistSnapshot(room).catch(() => {
        // Best-effort auto-snapshot.
      })
    }, snapshotIntervalMs)
  }

  function getRoom(name: string): Room {
    const existing = rooms.get(name)
    if (existing) return existing

    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    const room: Room = {
      name,
      kind: isNotificationRoomName(name) ? 'notification' : 'document',
      doc,
      awareness,
      conns: new Map(),
      syncListeners: new Map(),
      lastEditAt: null,
      lastEditUserId: null,
      lastEditSource: null,
      snapshotTimer: null,
      lastSnapshotHash: null,
      hydratePromise: null,
      hydrated: false,
    }

    awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        conn: WebSocket | null,
      ) => {
        const changedClients = added.concat(updated, removed)
        const room = rooms.get(name)
        if (!room) return

        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageAwareness)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
        )
        const msg = encoding.toUint8Array(encoder)

        for (const [ws] of room.conns) {
          if (ws !== conn && ws.readyState === ws.OPEN) {
            ws.send(msg)
          }
        }
      },
    )

    rooms.set(name, room)
    return room
  }

  async function hydrateRoom(room: Room): Promise<void> {
    if (room.kind !== 'document') return
    if (room.hydrated) return
    if (room.hydratePromise) {
      await room.hydratePromise
      return
    }

    room.hydratePromise = (async () => {
      const snapshot = await config?.snapshotLoader?.(room.name)
      if (!snapshot || snapshot.byteLength === 0) {
        room.hydrated = true
        return
      }

      Y.applyUpdate(room.doc, snapshot)
      room.lastSnapshotHash = hashSnapshot(snapshot)
      room.hydrated = true
    })().finally(() => {
      room.hydratePromise = null
    })

    await room.hydratePromise
  }

  function handleMessage(ws: WebSocket, room: Room, data: Uint8Array) {
    const meta = connMeta.get(ws)
    const decoder = decoding.createDecoder(data)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case messageSync: {
        const syncTypeDecoder = decoding.createDecoder(data)
        decoding.readVarUint(syncTypeDecoder) // outer type
        const syncMessageType = decoding.readVarUint(syncTypeDecoder)

        if (room.kind === 'notification') {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws)
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder))
          }
          return
        }

        // Read-only users may complete handshake (type 0) but cannot push updates (type 1/2).
        if (meta?.canEdit === false && syncMessageType !== 0) {
          return
        }

        const shouldEmitDocEvents = syncMessageType !== 0
        const beforeState = shouldEmitDocEvents ? captureDocEventState(room.doc) : null

        if (shouldEmitDocEvents) {
          room.lastEditAt = Date.now()
          room.lastEditUserId = meta?.userId ?? null
          room.lastEditSource = meta?.source ?? null
          scheduleSnapshot(room)
        }

        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws)
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder))
        }

        if (shouldEmitDocEvents && beforeState) {
          const timestamp = new Date().toISOString()
          const actorId = meta?.userId ?? null
          const actorSource = meta?.source ?? null
          const afterState = captureDocEventState(room.doc)

          emitEvent({
            eventType: 'document.edited',
            documentId: room.name,
            actorId,
            actorSource,
            timestamp,
          })

          for (const commentId of afterState.commentIds) {
            if (beforeState.commentIds.has(commentId)) continue
            const comment = afterState.commentsById.get(commentId)
            emitEvent({
              eventType: 'comment.created',
              documentId: room.name,
              actorId,
              actorSource,
              timestamp,
              data: {
                commentId,
                commentAuthorId: comment?.authorId ?? '',
                text: comment?.text ?? '',
              },
            })
          }

          for (const [signature, reply] of afterState.replySignatures) {
            if (beforeState.replySignatures.has(signature)) continue
            emitEvent({
              eventType: 'comment.replied',
              documentId: room.name,
              actorId,
              actorSource,
              timestamp,
              data: {
                commentId: reply.commentId,
                commentAuthorId: reply.commentAuthorId,
                replyAuthorId: reply.replyAuthorId,
                text: reply.text,
              },
            })
          }

          for (const signature of afterState.mentionSignatures) {
            if (beforeState.mentionSignatures.has(signature)) continue
            const [commentId, mentionedAgent] = signature.split('\u0000')
            emitEvent({
              eventType: 'comment.mention',
              documentId: room.name,
              actorId,
              actorSource,
              timestamp,
              data: { commentId, mentionedAgent },
            })
          }

          for (const commentId of afterState.suggestionIds) {
            if (beforeState.suggestionIds.has(commentId)) continue
            emitEvent({
              eventType: 'suggestion.created',
              documentId: room.name,
              actorId,
              actorSource,
              timestamp,
              data: { commentId },
            })
          }

          for (const [commentId, status] of afterState.suggestionStatusByCommentId) {
            const previous = beforeState.suggestionStatusByCommentId.get(commentId)
            if (previous === status) continue
            if (status === 'accepted') {
              emitEvent({
                eventType: 'suggestion.accepted',
                documentId: room.name,
                actorId,
                actorSource,
                timestamp,
                data: { commentId },
              })
            } else if (status === 'dismissed') {
              emitEvent({
                eventType: 'suggestion.dismissed',
                documentId: room.name,
                actorId,
                actorSource,
                timestamp,
                data: { commentId },
              })
            }
          }

          for (const discussionId of afterState.discussionIds) {
            if (beforeState.discussionIds.has(discussionId)) continue
            emitEvent({
              eventType: 'discussion.created',
              documentId: room.name,
              actorId,
              actorSource,
              timestamp,
              data: { discussionId },
            })
          }
        }
        break
      }
      case messageAwareness: {
        const update = decoding.readVarUint8Array(decoder)
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws)
        break
      }
    }
  }

  function setupConnection(ws: WebSocket, room: Room) {
    room.conns.set(ws, new Set())

    // Send sync step 1 to the new client
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, room.doc)
    ws.send(encoding.toUint8Array(encoder))

    // Send current awareness state
    const awarenessStates = room.awareness.getStates()
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, messageAwareness)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys())),
      )
      ws.send(encoding.toUint8Array(awarenessEncoder))
    }

    // Listen for doc updates to broadcast to this client
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === ws) return
      const updateEncoder = encoding.createEncoder()
      encoding.writeVarUint(updateEncoder, messageSync)
      syncProtocol.writeUpdate(updateEncoder, update)
      if (ws.readyState === ws.OPEN) {
        ws.send(encoding.toUint8Array(updateEncoder))
      }
    }
    room.syncListeners.set(ws, onUpdate)
    room.doc.on('update', onUpdate)

    ws.on('message', (raw: ArrayBuffer | Buffer) => {
      try {
        const data =
          raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        handleMessage(ws, room, data)
      } catch {
        // Malformed protocol payload from client.
        if (ws.readyState === ws.OPEN) {
          ws.close(4400, 'Invalid message')
        }
      }
    })

    ws.on('close', async () => {
      const meta = connMeta.get(ws)
      const controlledIds = room.conns.get(ws)
      room.conns.delete(ws)
      const listener = room.syncListeners.get(ws)
      if (listener) {
        room.doc.off('update', listener)
        room.syncListeners.delete(ws)
      }
      connMeta.delete(ws)

      if (controlledIds) {
        awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(controlledIds), null)
      }

      if (room.kind === 'notification' && meta?.userId) {
        const conns = notificationConnections.get(meta.userId)
        conns?.delete(ws)
        if (conns && conns.size === 0) {
          notificationConnections.delete(meta.userId)
        }
      }

      // Clean up empty rooms
      if (room.conns.size === 0) {
        clearSnapshotTimer(room)
        await maybePersistSnapshot(room).catch(() => {
          // Best-effort final snapshot on room teardown.
        })
        room.awareness.destroy()
        room.doc.destroy()
        rooms.delete(room.name)
      }
    })
  }

  // HTTP server for health check + WebSocket upgrade
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }
    if (req.method === 'GET' && pathname === '/connections') {
      const result: Array<{ docId: string; userId: string; source: 'daemon' }> = []
      for (const [roomName, room] of rooms) {
        for (const [ws] of room.conns) {
          const meta = connMeta.get(ws)
          if (meta?.source === 'daemon' && meta.userId) {
            result.push({ docId: roomName, userId: meta.userId, source: 'daemon' })
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }
    if (req.method === 'GET' && pathname.startsWith('/snapshot/')) {
      const docId = decodeURIComponent(pathname.slice('/snapshot/'.length))
      if (!docId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid document id' }))
        return
      }

      const room = rooms.get(docId)
      if (!room) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'room not found' }))
        return
      }

      const snapshot = Y.encodeStateAsUpdate(room.doc)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.from(snapshot))
      return
    }
    if (req.method === 'POST' && pathname.startsWith('/replace/')) {
      const docId = decodeURIComponent(pathname.slice('/replace/'.length))
      if (!docId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid document id' }))
        return
      }

      const room = rooms.get(docId)
      if (!room) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'room not found' }))
        return
      }

      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const payload = Buffer.concat(chunks)
          if (payload.byteLength === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'empty payload' }))
            return
          }

          const incomingUpdate = new Uint8Array(
            payload.buffer,
            payload.byteOffset,
            payload.byteLength,
          )
          const tempDoc = new Y.Doc()
          Y.applyUpdate(tempDoc, incomingUpdate)
          const normalizedUpdate = Y.encodeStateAsUpdate(tempDoc)
          Y.applyUpdate(room.doc, normalizedUpdate)
          tempDoc.destroy()

          room.lastEditAt = Date.now()
          room.lastEditUserId = null
          room.lastEditSource = null
          scheduleSnapshot(room)
          emitEvent({
            eventType: 'document.edited',
            documentId: room.name,
            actorId: null,
            actorSource: null,
            timestamp: new Date().toISOString(),
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid update payload' }))
        }
      })
      req.on('error', () => {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'failed to read request body' }))
      })
      return
    }
    if (req.method === 'POST' && pathname === '/notifications/broadcast') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            userId?: unknown
            userIds?: unknown
            event?: NotificationRealtimeEvent
          }
          const userIds = Array.isArray(body.userIds)
            ? body.userIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            : typeof body.userId === 'string' && body.userId.trim().length > 0
              ? [body.userId]
              : []

          if (userIds.length === 0 || !body.event || typeof body.event !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'invalid notification payload' }))
            return
          }

          for (const userId of userIds) {
            pushNotificationToUser(userId, body.event)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid request body' }))
        }
      })
      req.on('error', () => {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'failed to read request body' }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url!, 'http://localhost')
      const roomName = decodeURIComponent(url.pathname.slice(1) || 'default')
      const notificationUserId = getNotificationRoomUserId(roomName)
      const hasAuthHeader =
        typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0
      const source: 'browser' | 'daemon' = hasAuthHeader ? 'daemon' : 'browser'
      let userId: string | null = null
      let canEdit = true

      if (config?.auth) {
        let payload: TokenPayload | null = null
        if (source === 'daemon') {
          const authHeader = req.headers.authorization
          const token = authHeader?.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length)
            : null
          if (!token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
            return
          }
          payload = await config.auth.verifyToken(token)
        } else if (source === 'browser') {
          const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : null
          if (cookieHeader && config.auth.verifySessionCookie) {
            payload = await config.auth.verifySessionCookie(cookieHeader)
          }
        }

        if (!payload) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
          return
        }

        userId = payload.id

        // Enforce per-user connection limit
        const conns = userConnections.get(userId)
        if (conns && conns.size >= MAX_CONNECTIONS_PER_USER) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            ws.close(4029, 'Too many connections')
          })
          return
        }

        if (notificationUserId) {
          if (notificationUserId !== payload.id) {
            wss.handleUpgrade(req, socket, head, (ws) => {
              ws.close(4403, 'Forbidden')
            })
            return
          }
          canEdit = false
        } else {
          const canView = await config.auth.checkPermission(
            payload.id,
            'can_view',
            'document',
            roomName,
          )
          if (!canView) {
            wss.handleUpgrade(req, socket, head, (ws) => {
              ws.close(4403, 'Forbidden')
            })
            return
          }
          canEdit = await config.auth.checkPermission(payload.id, 'can_edit', 'document', roomName)

          // Check agent policy for daemon connections
          if (source === 'daemon' && config.checkAgentPolicy) {
            const policy = await config.checkAgentPolicy(roomName, source)
            if (!policy.allowed) {
              wss.handleUpgrade(req, socket, head, (ws) => {
                ws.close(policy.code || 4450, policy.reason || 'Agent editing disabled')
              })
              return
            }
          }
        }
      }

      const room = getRoom(roomName)
      await hydrateRoom(room)

      wss.handleUpgrade(req, socket, head, (ws) => {
        // Store connection metadata
        connMeta.set(ws, { source, userId: userId ?? undefined, canEdit })

        // Track connection for rate limiting
        if (userId) {
          let conns = userConnections.get(userId)
          if (!conns) {
            conns = new Set()
            userConnections.set(userId, conns)
          }
          conns.add(ws)

          ws.on('close', () => {
            conns!.delete(ws)
            if (conns!.size === 0) userConnections.delete(userId!)
          })
        }

        if (room.kind === 'notification' && userId) {
          let conns = notificationConnections.get(userId)
          if (!conns) {
            conns = new Set()
            notificationConnections.set(userId, conns)
          }
          conns.add(ws)
        }

        setupConnection(ws, room)
      })
    } catch (err) {
      console.error('[sync-server] WebSocket upgrade error:', err)
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
    }
  })

  return { server, wss, rooms, connMeta, pushNotificationToUser }
}
