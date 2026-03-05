import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { Socket } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Awareness } from 'y-protocols/awareness'
import { SyncClient } from './sync-client.js'

const messageSync = 0
const messageAwareness = 1

// Minimal sync server for testing (mirrors the real sync-server protocol)
interface TestRoom {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
}

function createTestSyncServer() {
  const rooms = new Map<string, TestRoom>()

  function getRoom(name: string): TestRoom {
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

    const room: TestRoom = { doc, awareness, conns: new Map() }
    rooms.set(name, room)
    return room
  }

  function handleMessage(ws: WebSocket, room: TestRoom, data: Uint8Array) {
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

  function setupConnection(ws: WebSocket, room: TestRoom) {
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

    // Listen for doc updates to broadcast
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
      const data =
        raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : new Uint8Array(
              (raw as Buffer).buffer,
              (raw as Buffer).byteOffset,
              (raw as Buffer).byteLength,
            )
      handleMessage(ws, room, data)
    })

    ws.on('close', () => {
      const controlledIds = room.conns.get(ws)
      room.conns.delete(ws)
      room.doc.off('update', onUpdate)

      if (controlledIds) {
        awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(controlledIds), null)
      }

      // Clean up empty rooms
      if (room.conns.size === 0) {
        room.awareness.destroy()
        room.doc.destroy()
        const roomName = [...rooms.entries()].find(([, r]) => r === room)?.[0]
        if (roomName) rooms.delete(roomName)
      }
    })
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url!, 'http://localhost')
    const roomName = url.pathname.slice(1) || 'default'

    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = getRoom(roomName)
      setupConnection(ws, room)
    })
  })

  return { server, rooms }
}

// Test infrastructure
let server: http.Server | null = null
const sockets: Socket[] = []

async function startServer(): Promise<number> {
  const { server: s } = createTestSyncServer()
  server = s
  server.on('connection', (socket: Socket) => sockets.push(socket))
  return new Promise((resolve) => {
    server!.listen(0, () => {
      const addr = server!.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

async function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve()
    for (const s of sockets) s.destroy()
    sockets.length = 0
    server.close(() => {
      server = null
      resolve()
    })
  })
}

afterEach(async () => {
  await closeServer()
})

describe('SyncClient', () => {
  it('connects to sync server and completes handshake', async () => {
    const port = await startServer()
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    const client = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'test-doc',
      ydoc,
      awareness,
      token: '',
    })

    const synced = new Promise<void>((resolve) => {
      client.once('synced', resolve)
    })

    client.connect()
    await synced

    expect(client.synced).toBe(true)
    expect(client.isConnected()).toBe(true)

    client.disconnect()
    awareness.destroy()
    ydoc.destroy()
  })

  it('syncs document content from server to client', async () => {
    const port = await startServer()

    // Client 1: write some content
    const doc1 = new Y.Doc()
    const awareness1 = new Awareness(doc1)
    const client1 = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'sync-doc',
      ydoc: doc1,
      awareness: awareness1,
      token: '',
    })

    const synced1 = new Promise<void>((r) => client1.once('synced', r))
    client1.connect()
    await synced1

    doc1.getText('codemirror').insert(0, 'hello from client 1')
    await new Promise((r) => setTimeout(r, 300))

    // Client 2: should receive client 1's content
    const doc2 = new Y.Doc()
    const awareness2 = new Awareness(doc2)
    const client2 = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'sync-doc',
      ydoc: doc2,
      awareness: awareness2,
      token: '',
    })

    const synced2 = new Promise<void>((r) => client2.once('synced', r))
    client2.connect()
    await synced2
    await new Promise((r) => setTimeout(r, 300))

    expect(doc2.getText('codemirror').toString()).toBe('hello from client 1')

    client1.disconnect()
    client2.disconnect()
    awareness1.destroy()
    awareness2.destroy()
    doc1.destroy()
    doc2.destroy()
  })

  it('syncs real-time updates between clients', async () => {
    const port = await startServer()

    const doc1 = new Y.Doc()
    const awareness1 = new Awareness(doc1)
    const client1 = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'realtime-doc',
      ydoc: doc1,
      awareness: awareness1,
      token: '',
    })

    const doc2 = new Y.Doc()
    const awareness2 = new Awareness(doc2)
    const client2 = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'realtime-doc',
      ydoc: doc2,
      awareness: awareness2,
      token: '',
    })

    const synced1 = new Promise<void>((r) => client1.once('synced', r))
    const synced2 = new Promise<void>((r) => client2.once('synced', r))

    client1.connect()
    client2.connect()
    await Promise.all([synced1, synced2])

    // Client 1 makes a change
    doc1.getText('codemirror').insert(0, 'real-time update')
    await new Promise((r) => setTimeout(r, 500))

    expect(doc2.getText('codemirror').toString()).toBe('real-time update')

    client1.disconnect()
    client2.disconnect()
    awareness1.destroy()
    awareness2.destroy()
    doc1.destroy()
    doc2.destroy()
  })

  it('disconnects cleanly', async () => {
    const port = await startServer()
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    const client = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'disconnect-doc',
      ydoc,
      awareness,
      token: '',
    })

    const synced = new Promise<void>((r) => client.once('synced', r))
    client.connect()
    await synced

    client.disconnect()
    expect(client.isConnected()).toBe(false)
    expect(client.synced).toBe(false)

    awareness.destroy()
    ydoc.destroy()
  })

  it('sets awareness with daemon source and user name', async () => {
    const port = await startServer()
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    const client = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'awareness-doc',
      ydoc,
      awareness,
      token: '',
      userName: 'Test User via Agent',
    })

    // Check awareness state was set
    const localState = awareness.getLocalState()
    expect(localState?.source).toBe('daemon')
    expect(localState?.user?.name).toBe('Test User via Agent')
    expect(localState?.user?.color).toBe('#888888')

    client.disconnect()
    awareness.destroy()
    ydoc.destroy()
  })

  it('uses default [Agent] name when userName not provided', async () => {
    const port = await startServer()
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    const client = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'default-name-doc',
      ydoc,
      awareness,
      token: '',
    })

    const localState = awareness.getLocalState()
    expect(localState?.user?.name).toBe('[Agent]')

    client.disconnect()
    awareness.destroy()
    ydoc.destroy()
  })

  it('does not reconnect after disconnect()', async () => {
    const port = await startServer()
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    const client = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'no-reconnect-doc',
      ydoc,
      awareness,
      token: '',
    })

    const synced = new Promise<void>((r) => client.once('synced', r))
    client.connect()
    await synced

    client.disconnect()

    // Wait a bit to ensure no reconnection attempt
    await new Promise((r) => setTimeout(r, 1500))
    expect(client.isConnected()).toBe(false)
    expect(client.synced).toBe(false)

    awareness.destroy()
    ydoc.destroy()
  })

  it('ignores connect() when already connected', async () => {
    const port = await startServer()
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    const client = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'dup-connect-doc',
      ydoc,
      awareness,
      token: '',
    })

    const synced = new Promise<void>((r) => client.once('synced', r))
    client.connect()
    await synced

    // Second connect() call should be a no-op
    client.connect()
    expect(client.isConnected()).toBe(true)

    client.disconnect()
    awareness.destroy()
    ydoc.destroy()
  })

  it('updateToken() updates the stored token', async () => {
    const port = await startServer()
    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    const client = new SyncClient({
      serverUrl: `http://localhost:${port}`,
      docId: 'token-update-doc',
      ydoc,
      awareness,
      token: 'initial-token',
    })

    client.updateToken('new-token')
    // We can verify by checking that subsequent connect uses the new token
    // (token is embedded in the URL; we just verify updateToken doesn't throw)

    client.disconnect()
    awareness.destroy()
    ydoc.destroy()
  })
})
