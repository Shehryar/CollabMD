import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const messageSync = 0
const messageAwareness = 1

// Room-per-document: each room holds a shared Y.Doc and awareness state
interface Room {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
}

export function createSyncServer() {
  const rooms = new Map<string, Room>()

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
    const decoder = decoding.createDecoder(data)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case messageSync: {
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
      const data = raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      handleMessage(ws, room, data)
    })

    ws.on('close', () => {
      const controlledIds = room.conns.get(ws)
      room.conns.delete(ws)
      room.doc.off('update', onUpdate)

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
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    // Room name comes from the URL path: /doc-id
    const roomName = req.url?.slice(1) ?? 'default'

    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = getRoom(roomName)
      setupConnection(ws, room)
    })
  })

  return { server, wss, rooms }
}
