import { describe, it, expect, afterEach } from 'vitest'
import { createSyncServer, type SyncServerConfig } from './server.js'
import type { TokenPayload } from './auth.js'
import { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { Socket } from 'node:net'

const messageSync = 0

let server: ReturnType<typeof createSyncServer>['server']
const sockets: Socket[] = []
const openWs: WebSocket[] = []

function startServer(config?: SyncServerConfig): Promise<number> {
  const result = createSyncServer(config)
  server = result.server
  server.on('connection', (s: Socket) => sockets.push(s))
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve()
    for (const ws of openWs) {
      if (ws.readyState === WebSocket.OPEN) ws.close()
    }
    openWs.length = 0
    for (const s of sockets) s.destroy()
    sockets.length = 0
    server.close(() => resolve())
  })
}

afterEach(async () => {
  await closeServer()
})

interface MsgQueue {
  next: () => Promise<Uint8Array>
}

function createMsgQueue(ws: WebSocket): MsgQueue {
  const buffer: Uint8Array[] = []
  const waiters: Array<(msg: Uint8Array) => void> = []

  ws.on('message', (data: ArrayBuffer | Buffer) => {
    const msg = new Uint8Array(
      data instanceof ArrayBuffer
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    )
    const waiter = waiters.shift()
    if (waiter) {
      waiter(msg)
    } else {
      buffer.push(msg)
    }
  })

  return {
    next: () =>
      new Promise((resolve) => {
        const msg = buffer.shift()
        if (msg) {
          resolve(msg)
        } else {
          waiters.push(resolve)
        }
      }),
  }
}

function connectWs(
  port: number,
  room: string,
): Promise<{ ws: WebSocket; msgs: MsgQueue }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/${room}`)
    ws.binaryType = 'arraybuffer'
    const msgs = createMsgQueue(ws)
    ws.on('open', () => {
      openWs.push(ws)
      resolve({ ws, msgs })
    })
    ws.on('error', reject)
  })
}

// --- HTTP health check ---

describe('health endpoint', () => {
  it('returns 200 OK on GET /health', async () => {
    const port = await startServer()
    const res = await fetch(`http://localhost:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
  })

  it('returns 404 for unknown routes', async () => {
    const port = await startServer()
    const res = await fetch(`http://localhost:${port}/unknown`)
    expect(res.status).toBe(404)
  })
})

// --- WebSocket sync ---

describe('WebSocket sync', () => {
  it('accepts a WebSocket connection and sends sync step 1', async () => {
    const port = await startServer()
    const { ws, msgs } = await connectWs(port, 'test-doc')

    const msg = await msgs.next()
    const decoder = decoding.createDecoder(msg)
    const outerType = decoding.readVarUint(decoder)
    expect(outerType).toBe(messageSync)
    const syncType = decoding.readVarUint(decoder)
    expect(syncType).toBe(0) // SyncStep1

    ws.close()
  })

  it('completes full sync handshake and receives SyncStep2', async () => {
    const port = await startServer()
    const { ws, msgs } = await connectWs(port, 'handshake-test')
    const doc = new Y.Doc()

    // Read server's sync step 1
    const msg1 = await msgs.next()
    const decoder1 = decoding.createDecoder(msg1)
    expect(decoding.readVarUint(decoder1)).toBe(messageSync)

    // Send our SyncStep2 response
    const respEncoder = encoding.createEncoder()
    encoding.writeVarUint(respEncoder, messageSync)
    syncProtocol.readSyncMessage(decoder1, respEncoder, doc, null)
    if (encoding.length(respEncoder) > 1) {
      ws.send(encoding.toUint8Array(respEncoder))
    }

    // Send our SyncStep1 to server
    const step1Encoder = encoding.createEncoder()
    encoding.writeVarUint(step1Encoder, messageSync)
    syncProtocol.writeSyncStep1(step1Encoder, doc)
    ws.send(encoding.toUint8Array(step1Encoder))

    // Wait for server's SyncStep2 response, skipping any awareness messages
    await new Promise((r) => setTimeout(r, 100))
    let syncType = -1
    for (let i = 0; i < 5; i++) {
      const m = await msgs.next()
      const d = decoding.createDecoder(m)
      if (decoding.readVarUint(d) === messageSync) {
        syncType = decoding.readVarUint(d)
        break
      }
    }
    expect(syncType).toBe(1) // SyncStep2

    ws.close()
  })

  it('syncs document state to a new client', async () => {
    const port = await startServer()

    // Client 1: connect, handshake, insert text
    const doc1 = new Y.Doc()
    const { ws: ws1, msgs: msgs1 } = await connectWs(port, 'sync-test')

    // Read server's sync step 1
    const serverStep1 = await msgs1.next()
    const dec1 = decoding.createDecoder(serverStep1)
    decoding.readVarUint(dec1) // outer messageSync

    // Send our sync step 2
    const enc1 = encoding.createEncoder()
    encoding.writeVarUint(enc1, messageSync)
    syncProtocol.readSyncMessage(dec1, enc1, doc1, null)
    if (encoding.length(enc1) > 1) {
      ws1.send(encoding.toUint8Array(enc1))
    }

    // Send our sync step 1
    const ourStep1 = encoding.createEncoder()
    encoding.writeVarUint(ourStep1, messageSync)
    syncProtocol.writeSyncStep1(ourStep1, doc1)
    ws1.send(encoding.toUint8Array(ourStep1))

    // Wait a bit for handshake to complete
    await new Promise((r) => setTimeout(r, 100))

    // Insert text into doc1
    doc1.getText('test').insert(0, 'hello')

    // Send the Y.Doc update to the server
    // We need to listen for updates from doc1 and forward them
    // Actually, we need to explicitly send the update
    const update = Y.encodeStateAsUpdate(doc1)
    const updateEnc = encoding.createEncoder()
    encoding.writeVarUint(updateEnc, messageSync)
    syncProtocol.writeUpdate(updateEnc, update)
    ws1.send(encoding.toUint8Array(updateEnc))

    // Wait for server to process
    await new Promise((r) => setTimeout(r, 100))

    // Client 2: connect to same room
    const doc2 = new Y.Doc()
    const { ws: ws2, msgs: msgs2 } = await connectWs(port, 'sync-test')

    // Read server's sync step 1
    const serverStep1C2 = await msgs2.next()
    const dec2 = decoding.createDecoder(serverStep1C2)
    decoding.readVarUint(dec2) // outer messageSync

    // Process it - this applies server state to doc2
    const enc2 = encoding.createEncoder()
    encoding.writeVarUint(enc2, messageSync)
    syncProtocol.readSyncMessage(dec2, enc2, doc2, null)
    if (encoding.length(enc2) > 1) {
      ws2.send(encoding.toUint8Array(enc2))
    }

    // Send our sync step 1
    const ourStep1C2 = encoding.createEncoder()
    encoding.writeVarUint(ourStep1C2, messageSync)
    syncProtocol.writeSyncStep1(ourStep1C2, doc2)
    ws2.send(encoding.toUint8Array(ourStep1C2))

    // Read and apply ALL messages for a bit (step 2 + potential updates)
    await new Promise<void>((resolve) => {
      let resolved = false
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve()
        }
      }, 300)

      const processMsg = async () => {
        while (!resolved) {
          const m = await Promise.race([
            msgs2.next(),
            new Promise<null>((r) => setTimeout(() => r(null), 300)),
          ])
          if (!m) break
          const d = decoding.createDecoder(m)
          const type = decoding.readVarUint(d)
          if (type === messageSync) {
            const applyEnc = encoding.createEncoder()
            encoding.writeVarUint(applyEnc, messageSync)
            syncProtocol.readSyncMessage(d, applyEnc, doc2, null)
            if (encoding.length(applyEnc) > 1) {
              ws2.send(encoding.toUint8Array(applyEnc))
            }
          }
        }
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          resolve()
        }
      }
      processMsg()
    })

    expect(doc2.getText('test').toString()).toBe('hello')

    ws1.close()
    ws2.close()
  })
})

// --- WebSocket auth ---

const validPayload: TokenPayload = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
}

function mockAuth(opts?: {
  verifyResult?: TokenPayload | null
  permissionResult?: boolean
}): SyncServerConfig['auth'] {
  return {
    verifyToken: async () => opts?.verifyResult ?? null,
    checkPermission: async () => opts?.permissionResult ?? false,
  }
}

function connectWsRaw(
  port: number,
  path: string,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`)
    ws.binaryType = 'arraybuffer'
    ws.on('open', () => {
      openWs.push(ws)
      resolve(ws)
    })
    ws.on('error', reject)
  })
}

describe('WebSocket auth', () => {
  it('rejects connection without token when auth is enabled', async () => {
    const port = await startServer({ auth: mockAuth() })

    const ws = new WebSocket(`ws://localhost:${port}/my-doc`)
    const error = await new Promise<Error>((resolve) => {
      ws.on('error', resolve)
    })
    expect(error).toBeTruthy()
  })

  it('rejects connection with invalid token', async () => {
    const port = await startServer({
      auth: mockAuth({ verifyResult: null }),
    })

    const ws = new WebSocket(`ws://localhost:${port}/my-doc?token=bad-token`)
    const error = await new Promise<Error>((resolve) => {
      ws.on('error', resolve)
    })
    expect(error).toBeTruthy()
  })

  it('rejects connection when user lacks permission (4403)', async () => {
    const port = await startServer({
      auth: mockAuth({ verifyResult: validPayload, permissionResult: false }),
    })

    const ws = new WebSocket(`ws://localhost:${port}/my-doc?token=valid`)
    ws.binaryType = 'arraybuffer'

    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c))
    })
    expect(code).toBe(4403)
  })

  it('allows connection with valid token and permission', async () => {
    const port = await startServer({
      auth: mockAuth({ verifyResult: validPayload, permissionResult: true }),
    })

    const ws = await connectWsRaw(port, '/my-doc?token=valid')
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('still allows connections without auth config (backward compat)', async () => {
    const port = await startServer()

    const { ws } = await connectWs(port, 'no-auth-doc')
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})
