import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { TokenPayload } from './auth.js'

const messageSync = 0
const messageAwareness = 1

// Room-per-document: each room holds a shared Y.Doc and awareness state
interface Room {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
}

interface ConnMeta {
  source?: 'browser' | 'daemon'
  userId?: string
  canEdit?: boolean
}

export interface SyncServerConfig {
  auth?: {
    verifyToken: (token: string) => Promise<TokenPayload | null>
    verifySessionCookie?: (cookieHeader: string) => Promise<TokenPayload | null>
    checkPermission: (userId: string, relation: string, objectType: string, objectId: string) => Promise<boolean>
  }
  checkAgentPolicy?: (docId: string, source: string) => Promise<{ allowed: boolean; code?: number; reason?: string }>
}

const MAX_CONNECTIONS_PER_USER = 20

export function createSyncServer(config?: SyncServerConfig) {
  const rooms = new Map<string, Room>()
  // Track active WebSocket connections per user for rate limiting
  const userConnections = new Map<string, Set<WebSocket>>()
  // Track connection metadata (source, userId)
  const connMeta = new Map<WebSocket, ConnMeta>()

  function getRoom(name: string): Room {
    const existing = rooms.get(name)
    if (existing) return existing

    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)

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

    const room: Room = { doc, awareness, conns: new Map() }
    rooms.set(name, room)
    return room
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

        // Read-only users may complete handshake (type 0) but cannot push updates (type 1/2).
        if (meta?.canEdit === false && syncMessageType !== 0) {
          return
        }

        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws)
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder))
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
        awarenessProtocol.encodeAwarenessUpdate(
          room.awareness,
          Array.from(awarenessStates.keys()),
        ),
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
    room.doc.on('update', onUpdate)

    ws.on('message', (raw: ArrayBuffer | Buffer) => {
      try {
        const data = raw instanceof ArrayBuffer
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

    ws.on('close', () => {
      const controlledIds = room.conns.get(ws)
      room.conns.delete(ws)
      room.doc.off('update', onUpdate)
      connMeta.delete(ws)

      if (controlledIds) {
        awarenessProtocol.removeAwarenessStates(
          room.awareness,
          Array.from(controlledIds),
          null,
        )
      }

      // Clean up empty rooms
      if (room.conns.size === 0) {
        room.awareness.destroy()
        room.doc.destroy()
        rooms.delete(
          [...rooms.entries()].find(([, r]) => r === room)?.[0] ?? '',
        )
      }
    })
  }

  // HTTP server for health check + WebSocket upgrade
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }
    if (req.method === 'GET' && req.url === '/connections') {
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
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url!, 'http://localhost')
      const roomName = url.pathname.slice(1) || 'default'
      const hasAuthHeader = typeof req.headers.authorization === 'string' && req.headers.authorization.length > 0
      const source: 'browser' | 'daemon' = hasAuthHeader ? 'daemon' : 'browser'
      let userId: string | null = null
      let canEdit = true

      if (config?.auth) {
        let payload: TokenPayload | null = null
        if (source === 'daemon') {
          const authHeader = req.headers.authorization
          const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
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

        const canView = await config.auth.checkPermission(payload.id, 'can_view', 'document', roomName)
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

        const room = getRoom(roomName)
        setupConnection(ws, room)
      })
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
    }
  })

  return { server, wss, rooms, connMeta }
}
