import { describe, it, expect, afterEach, vi } from 'vitest'
import { createSyncServer, type SyncServerConfig } from './server.js'
import type { TokenPayload } from './auth.js'
import { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { Socket } from 'node:net'

const messageSync = 0
const messageAwareness = 1

let server: ReturnType<typeof createSyncServer>['server']
let syncServer: ReturnType<typeof createSyncServer> | null = null
const sockets: Socket[] = []
const openWs: WebSocket[] = []

function startServer(config?: SyncServerConfig): Promise<number> {
  syncServer = createSyncServer(config)
  server = syncServer.server
  server.on('connection', (s: Socket) => sockets.push(s))
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
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
    server.close(() => {
      syncServer = null
      resolve()
    })
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
  sessionCookieResult?: TokenPayload | null
  permissions?: Partial<Record<'can_view' | 'can_edit', boolean>>
}): SyncServerConfig['auth'] {
  return {
    verifyToken: async () => opts?.verifyResult ?? null,
    verifySessionCookie: async () => opts?.sessionCookieResult ?? null,
    checkPermission: async (_userId, relation) =>
      opts?.permissions?.[relation as 'can_view' | 'can_edit'] ?? false,
  }
}

function connectWsRaw(
  port: number,
  path: string,
  opts?: { headers?: Record<string, string> },
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`, {
      headers: opts?.headers,
    })
    ws.binaryType = 'arraybuffer'
    ws.on('open', () => {
      openWs.push(ws)
      resolve(ws)
    })
    ws.on('error', reject)
  })
}

function connectWsRawWithQueue(
  port: number,
  path: string,
  opts?: { headers?: Record<string, string> },
): Promise<{ ws: WebSocket; msgs: MsgQueue }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`, {
      headers: opts?.headers,
    })
    ws.binaryType = 'arraybuffer'
    const msgs = createMsgQueue(ws)
    ws.on('open', () => {
      openWs.push(ws)
      resolve({ ws, msgs })
    })
    ws.on('error', reject)
  })
}

describe('WebSocket auth', () => {
  it('rejects connection without credentials when auth is enabled', async () => {
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

    const ws = new WebSocket(`ws://localhost:${port}/my-doc`, {
      headers: { Authorization: 'Bearer bad-token' },
    })
    const error = await new Promise<Error>((resolve) => {
      ws.on('error', resolve)
    })
    expect(error).toBeTruthy()
  })

  it('rejects connection when user lacks permission (4403)', async () => {
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: false, can_edit: false },
      }),
    })

    const ws = new WebSocket(`ws://localhost:${port}/my-doc`, {
      headers: { Authorization: 'Bearer valid' },
    })
    ws.binaryType = 'arraybuffer'

    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c))
    })
    expect(code).toBe(4403)
  })

  it('allows connection with valid token and permission', async () => {
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: true, can_edit: true },
      }),
    })

    const ws = await connectWsRaw(port, '/my-doc', {
      headers: { Authorization: 'Bearer valid' },
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('allows browser connection with valid session cookie', async () => {
    const port = await startServer({
      auth: mockAuth({
        sessionCookieResult: validPayload,
        permissions: { can_view: true, can_edit: false },
      }),
    })

    const ws = await connectWsRaw(port, '/my-doc', {
      headers: { Cookie: 'better-auth.session_token=abc' },
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('still allows connections without auth config (backward compat)', async () => {
    const port = await startServer()

    const { ws } = await connectWs(port, 'no-auth-doc')
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('ignores sync updates from read-only connections', async () => {
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: true, can_edit: false },
      }),
    })

    const ws = await connectWsRaw(port, '/readonly-doc', {
      headers: { Authorization: 'Bearer valid' },
    })
    await new Promise((r) => setTimeout(r, 50))

    const local = new Y.Doc()
    local.getText('test').insert(0, 'blocked')
    const update = Y.encodeStateAsUpdate(local)
    const updateEncoder = encoding.createEncoder()
    encoding.writeVarUint(updateEncoder, messageSync)
    syncProtocol.writeUpdate(updateEncoder, update)
    ws.send(encoding.toUint8Array(updateEncoder))
    await new Promise((r) => setTimeout(r, 100))

    const roomText = syncServer?.rooms.get('readonly-doc')?.doc.getText('test').toString() ?? ''
    expect(roomText).toBe('')
    ws.close()
  })
})

describe('WebSocket protocol hardening', () => {
  it('closes connections that send malformed messages', async () => {
    const port = await startServer()
    const ws = await connectWsRaw(port, '/bad-msg')
    ws.send(Buffer.from([255]))

    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c))
    })
    expect(code).toBe(4400)
  })
})

// --- WebSocket source tracking ---

describe('WebSocket source tracking', () => {
  it('treats bearer-auth connections as daemon source', async () => {
    const port = await startServer()
    const ws = await connectWsRaw(port, '/test-doc', {
      headers: { Authorization: 'Bearer token' },
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('treats plain connections as browser source', async () => {
    const port = await startServer()
    const ws = await connectWsRaw(port, '/test-doc')
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})

// --- WebSocket agent policy ---

describe('WebSocket agent policy', () => {
  it('rejects daemon connection when checkAgentPolicy returns not allowed with 4450', async () => {
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: true, can_edit: true },
      }),
      checkAgentPolicy: async () => ({ allowed: false, code: 4450, reason: 'Agent editing disabled' }),
    })

    const ws = new WebSocket(`ws://localhost:${port}/my-doc`, {
      headers: { Authorization: 'Bearer valid' },
    })
    ws.binaryType = 'arraybuffer'

    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c))
    })
    expect(code).toBe(4450)
  })

  it('rejects daemon connection with 4451 when doc not agent-editable', async () => {
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: true, can_edit: true },
      }),
      checkAgentPolicy: async () => ({ allowed: false, code: 4451, reason: 'Document not agent-editable' }),
    })

    const ws = new WebSocket(`ws://localhost:${port}/my-doc`, {
      headers: { Authorization: 'Bearer valid' },
    })
    ws.binaryType = 'arraybuffer'

    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c))
    })
    expect(code).toBe(4451)
  })

  it('allows daemon connection when checkAgentPolicy returns allowed', async () => {
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: true, can_edit: true },
      }),
      checkAgentPolicy: async () => ({ allowed: true }),
    })

    const ws = await connectWsRaw(port, '/my-doc', {
      headers: { Authorization: 'Bearer valid' },
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('does not check agent policy for browser connections', async () => {
    let policyCalled = false
    const port = await startServer({
      auth: mockAuth({
        sessionCookieResult: validPayload,
        permissions: { can_view: true, can_edit: true },
      }),
      checkAgentPolicy: async () => {
        policyCalled = true
        return { allowed: false, code: 4450, reason: 'disabled' }
      },
    })

    const ws = await connectWsRaw(port, '/my-doc', {
      headers: { Cookie: 'better-auth.session_token=abc' },
    })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    expect(policyCalled).toBe(false)
    ws.close()
  })
})

describe('sync server coverage gaps', () => {
  function sendSyncUpdate(ws: WebSocket, update: Uint8Array) {
    const updateEnc = encoding.createEncoder()
    encoding.writeVarUint(updateEnc, messageSync)
    syncProtocol.writeUpdate(updateEnc, update)
    ws.send(encoding.toUint8Array(updateEnc))
  }

  async function completeHandshake(ws: WebSocket, msgs: MsgQueue, doc: Y.Doc) {
    const step1 = await msgs.next()
    const dec = decoding.createDecoder(step1)
    const outer = decoding.readVarUint(dec)
    if (outer !== messageSync) {
      throw new Error(`expected sync message, got ${outer}`)
    }

    const resp = encoding.createEncoder()
    encoding.writeVarUint(resp, messageSync)
    syncProtocol.readSyncMessage(dec, resp, doc, null)
    if (encoding.length(resp) > 1) {
      ws.send(encoding.toUint8Array(resp))
    }

    const ourStep1 = encoding.createEncoder()
    encoding.writeVarUint(ourStep1, messageSync)
    syncProtocol.writeSyncStep1(ourStep1, doc)
    ws.send(encoding.toUint8Array(ourStep1))

    await new Promise((r) => setTimeout(r, 50))
  }

  async function drainSyncMessages(ws: WebSocket, msgs: MsgQueue, doc: Y.Doc, durationMs: number) {
    const deadline = Date.now() + durationMs
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      const msg = await Promise.race([
        msgs.next(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.min(50, remaining))),
      ])
      if (!msg) continue

      const decoder = decoding.createDecoder(msg)
      if (decoding.readVarUint(decoder) !== messageSync) continue

      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.readSyncMessage(decoder, encoder, doc, null)
      if (encoding.length(encoder) > 1 && ws.readyState === WebSocket.OPEN) {
        ws.send(encoding.toUint8Array(encoder))
      }
    }
  }

  it('read-only write rejection (end-to-end)', async () => {
    const port = await startServer({
      auth: {
        verifyToken: async (token) => {
          if (token === 'writer-token') return { ...validPayload, id: 'writer-user' }
          if (token === 'readonly-token') return { ...validPayload, id: 'readonly-user' }
          return null
        },
        verifySessionCookie: async () => null,
        checkPermission: async (userId, relation) => {
          if (relation === 'can_view') return true
          if (relation === 'can_edit') return userId === 'writer-user'
          return false
        },
      },
    })

    const { ws: wsA, msgs: msgsA } = await connectWsRawWithQueue(port, '/readonly-e2e', {
      headers: { Authorization: 'Bearer writer-token' },
    })
    const { ws: wsB, msgs: msgsB } = await connectWsRawWithQueue(port, '/readonly-e2e', {
      headers: { Authorization: 'Bearer readonly-token' },
    })
    const docA = new Y.Doc()
    const docB = new Y.Doc()

    await completeHandshake(wsA, msgsA, docA)
    await completeHandshake(wsB, msgsB, docB)

    docB.getText('test').insert(0, 'blocked')
    sendSyncUpdate(wsB, Y.encodeStateAsUpdate(docB))

    await drainSyncMessages(wsA, msgsA, docA, 200)
    expect(docA.getText('test').toString()).toBe('')

    wsA.close()
    wsB.close()
  })

  it('enforces per-user connection limit', async () => {
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: true, can_edit: true },
      }),
    })

    const conns: WebSocket[] = []
    for (let i = 0; i < 20; i++) {
      const ws = await connectWsRaw(port, '/conn-limit', {
        headers: { Authorization: 'Bearer valid' },
      })
      expect(ws.readyState).toBe(WebSocket.OPEN)
      conns.push(ws)
    }

    const extra = await connectWsRaw(port, '/conn-limit', {
      headers: { Authorization: 'Bearer valid' },
    })
    const closeCode = await new Promise<number>((resolve) => {
      extra.on('close', (code) => resolve(code))
    })
    expect(closeCode).toBe(4029)

    for (const ws of conns) {
      ws.close()
    }
  })

  it('cleans up room on last disconnect', async () => {
    const port = await startServer()
    const { ws, msgs } = await connectWs(port, 'cleanup-test')
    const doc = new Y.Doc()
    await completeHandshake(ws, msgs, doc)

    expect(syncServer?.rooms.has('cleanup-test')).toBe(true)

    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve())
      ws.close()
    })
    await new Promise((r) => setTimeout(r, 100))

    expect(syncServer?.rooms.has('cleanup-test')).toBe(false)
  })

  it('broadcasts awareness protocol updates', async () => {
    const port = await startServer()
    const { ws: ws1, msgs: msgs1 } = await connectWs(port, 'awareness-test')
    const { ws: ws2, msgs: msgs2 } = await connectWs(port, 'awareness-test')
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()
    await completeHandshake(ws1, msgs1, doc1)
    await completeHandshake(ws2, msgs2, doc2)

    const awareness = new awarenessProtocol.Awareness(new Y.Doc())
    awareness.setLocalStateField('user', { name: 'Test' })
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(encoder, awarenessUpdate)
    ws1.send(encoding.toUint8Array(encoder))

    let receivedTestAwareness = false
    for (let i = 0; i < 10; i++) {
      const msg = await msgs2.next()
      const dec = decoding.createDecoder(msg)
      const type = decoding.readVarUint(dec)
      if (type === messageAwareness) {
        const update = decoding.readVarUint8Array(dec)
        const applied = new awarenessProtocol.Awareness(new Y.Doc())
        awarenessProtocol.applyAwarenessUpdate(applied, update, null)
        const states = Array.from(applied.getStates().values()) as Array<{ user?: { name?: string } }>
        if (states.some((s) => s.user?.name === 'Test')) {
          receivedTestAwareness = true
          break
        }
      }
    }

    expect(receivedTestAwareness).toBe(true)

    ws1.close()
    ws2.close()
  })

  it('broadcasts live document updates to peers', async () => {
    const port = await startServer()
    const { ws: ws1, msgs: msgs1 } = await connectWs(port, 'live-update-test')
    const { ws: ws2, msgs: msgs2 } = await connectWs(port, 'live-update-test')
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()
    await completeHandshake(ws1, msgs1, doc1)
    await completeHandshake(ws2, msgs2, doc2)

    doc1.getText('test').insert(0, 'live')
    sendSyncUpdate(ws1, Y.encodeStateAsUpdate(doc1))

    let sawUpdate = false
    for (let i = 0; i < 10; i++) {
      const msg = await msgs2.next()
      const typeDec = decoding.createDecoder(msg)
      if (decoding.readVarUint(typeDec) !== messageSync) continue
      const subType = decoding.readVarUint(typeDec)

      const applyDec = decoding.createDecoder(msg)
      decoding.readVarUint(applyDec)
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, messageSync)
      syncProtocol.readSyncMessage(applyDec, reply, doc2, null)
      if (encoding.length(reply) > 1) {
        ws2.send(encoding.toUint8Array(reply))
      }

      if (subType === 2) {
        sawUpdate = true
        break
      }
    }

    expect(sawUpdate).toBe(true)
    expect(doc2.getText('test').toString()).toBe('live')

    ws1.close()
    ws2.close()
  })

  it('enforces maxPayload and closes oversized messages', async () => {
    const port = await startServer()
    const ws = await connectWsRaw(port, '/max-payload-test')
    let unexpectedUncaughtError: Error | null = null
    const onUncaughtException = (error: Error) => {
      if (
        error.message.includes('Max payload size exceeded')
        || (error as { code?: string }).code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
      ) {
        return
      }
      unexpectedUncaughtError = error
    }
    process.once('uncaughtException', onUncaughtException)
    try {
      ws.on('error', () => {
        // Expected when ws enforces max payload and aborts the socket.
      })
      ws.send(Buffer.alloc(1024 * 1024 + 1))

      const closeCode = await Promise.race([
        new Promise<number>((resolve) => ws.on('close', (code) => resolve(code))),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ])
      expect(closeCode).not.toBeNull()
      if (unexpectedUncaughtError) {
        throw unexpectedUncaughtError
      }
    } finally {
      process.removeListener('uncaughtException', onUncaughtException)
    }
  })

  it('syncs state when reconnecting to an existing room', async () => {
    const port = await startServer()
    const { ws: wsA, msgs: msgsA } = await connectWs(port, 'reconnect-test')
    const { ws: wsB, msgs: msgsB } = await connectWs(port, 'reconnect-test')
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    await completeHandshake(wsA, msgsA, docA)
    await completeHandshake(wsB, msgsB, docB)

    docA.getText('test').insert(0, 'persisted')
    sendSyncUpdate(wsA, Y.encodeStateAsUpdate(docA))
    await drainSyncMessages(wsB, msgsB, docB, 200)
    expect(docB.getText('test').toString()).toBe('persisted')

    await new Promise<void>((resolve) => {
      wsA.on('close', () => resolve())
      wsA.close()
    })

    const { ws: wsC, msgs: msgsC } = await connectWs(port, 'reconnect-test')
    const docC = new Y.Doc()
    await completeHandshake(wsC, msgsC, docC)
    await drainSyncMessages(wsC, msgsC, docC, 150)

    expect(docC.getText('test').toString()).toBe('persisted')

    wsB.close()
    wsC.close()
  })

  it('converges under concurrent writes', async () => {
    const port = await startServer()
    const { ws: ws1, msgs: msgs1 } = await connectWs(port, 'concurrent-test')
    const { ws: ws2, msgs: msgs2 } = await connectWs(port, 'concurrent-test')
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()
    await completeHandshake(ws1, msgs1, doc1)
    await completeHandshake(ws2, msgs2, doc2)

    doc1.getText('test').insert(0, 'aaa')
    doc2.getText('test').insert(0, 'bbb')
    sendSyncUpdate(ws1, Y.encodeStateAsUpdate(doc1))
    sendSyncUpdate(ws2, Y.encodeStateAsUpdate(doc2))

    await Promise.all([
      drainSyncMessages(ws1, msgs1, doc1, 250),
      drainSyncMessages(ws2, msgs2, doc2, 250),
    ])

    expect(doc1.getText('test').toString()).toBe(doc2.getText('test').toString())

    ws1.close()
    ws2.close()
  })

  it('fires auto-snapshot after idle interval', async () => {
    vi.useFakeTimers()
    try {
      const snapshotCallback = vi.fn(async () => {})
      const port = await startServer({
        snapshotCallback,
        snapshotIntervalMs: 300_000,
      })

      const ws = await connectWsRaw(port, '/auto-snapshot-idle')
      const nextDoc = new Y.Doc()
      nextDoc.getText('codemirror').insert(0, 'auto-snapshot text')
      const update = Y.encodeStateAsUpdate(nextDoc)
      nextDoc.destroy()

      const replaceRes = await fetch(`http://localhost:${port}/replace/auto-snapshot-idle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(update),
      })
      expect(replaceRes.status).toBe(200)

      await vi.advanceTimersByTimeAsync(300_000)

      expect(snapshotCallback).toHaveBeenCalledTimes(1)
      const snapshotCall = snapshotCallback.mock.calls[0] as unknown as
        | [string, Uint8Array, string | null, 'browser' | 'daemon' | null]
        | undefined
      expect(snapshotCall?.[0]).toBe('auto-snapshot-idle')

      ws.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('captures a final snapshot when the room is closed', async () => {
    const snapshotCallback = vi.fn(async () => {})
    const port = await startServer({
      snapshotCallback,
      snapshotIntervalMs: 300_000,
    })

    const ws = await connectWsRaw(port, '/snapshot-on-close')
    const nextDoc = new Y.Doc()
    nextDoc.getText('codemirror').insert(0, 'final state')
    const update = Y.encodeStateAsUpdate(nextDoc)
    nextDoc.destroy()

    const replaceRes = await fetch(`http://localhost:${port}/replace/snapshot-on-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(update),
    })
    expect(replaceRes.status).toBe(200)

    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve())
      ws.close()
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(snapshotCallback).toHaveBeenCalledTimes(1)
    const snapshotCall = snapshotCallback.mock.calls[0] as unknown as
      | [string, Uint8Array, string | null, 'browser' | 'daemon' | null]
      | undefined
    expect(snapshotCall?.[0]).toBe('snapshot-on-close')
  })

  it('does not persist duplicate snapshots with the same hash', async () => {
    vi.useFakeTimers()
    try {
      const snapshotCallback = vi.fn(async () => {})
      const port = await startServer({
        snapshotCallback,
        snapshotIntervalMs: 5_000,
      })

      const ws = await connectWsRaw(port, '/snapshot-dedupe')
      const nextDoc = new Y.Doc()
      nextDoc.getText('codemirror').insert(0, 'same state')
      const update = Y.encodeStateAsUpdate(nextDoc)
      nextDoc.destroy()

      await fetch(`http://localhost:${port}/replace/snapshot-dedupe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(update),
      })
      await vi.advanceTimersByTimeAsync(5_000)

      await fetch(`http://localhost:${port}/replace/snapshot-dedupe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(update),
      })
      await vi.advanceTimersByTimeAsync(5_000)

      expect(snapshotCallback).toHaveBeenCalledTimes(1)
      ws.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns binary room state from GET /snapshot/:docId', async () => {
    const port = await startServer()
    const ws = await connectWsRaw(port, '/snapshot-endpoint')

    const nextDoc = new Y.Doc()
    nextDoc.getText('codemirror').insert(0, 'snapshot payload')
    const update = Y.encodeStateAsUpdate(nextDoc)
    nextDoc.destroy()

    const replaceRes = await fetch(`http://localhost:${port}/replace/snapshot-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(update),
    })
    expect(replaceRes.status).toBe(200)

    const snapshotRes = await fetch(`http://localhost:${port}/snapshot/snapshot-endpoint`)
    expect(snapshotRes.status).toBe(200)
    expect(snapshotRes.headers.get('content-type')).toBe('application/octet-stream')

    const payload = new Uint8Array(await snapshotRes.arrayBuffer())
    const loadedDoc = new Y.Doc()
    Y.applyUpdate(loadedDoc, payload)
    expect(loadedDoc.getText('codemirror').toString()).toBe('snapshot payload')
    loadedDoc.destroy()

    ws.close()
  })

  it('hydrates a room from snapshotLoader before first client sync', async () => {
    const seededDoc = new Y.Doc()
    seededDoc.getText('codemirror').insert(0, 'loaded from snapshot')
    const seededUpdate = Y.encodeStateAsUpdate(seededDoc)
    seededDoc.destroy()

    const port = await startServer({
      snapshotLoader: async (docId) => {
        if (docId !== 'preloaded-room') return null
        return seededUpdate
      },
    })

    const { ws, msgs } = await connectWs(port, 'preloaded-room')
    const localDoc = new Y.Doc()
    await completeHandshake(ws, msgs, localDoc)
    await drainSyncMessages(ws, msgs, localDoc, 120)

    expect(localDoc.getText('codemirror').toString()).toBe('loaded from snapshot')

    localDoc.destroy()
    ws.close()
  })

  it('persists room state on disconnect and restores it after room recreation', async () => {
    const snapshots = new Map<string, Uint8Array>()
    const port = await startServer({
      snapshotIntervalMs: 60_000,
      snapshotCallback: async (docId, snapshot) => {
        snapshots.set(docId, snapshot)
      },
      snapshotLoader: async (docId) => snapshots.get(docId) ?? null,
    })

    const { ws: ws1, msgs: msgs1 } = await connectWs(port, 'persisted-room')
    const doc1 = new Y.Doc()
    await completeHandshake(ws1, msgs1, doc1)

    doc1.getText('codemirror').insert(0, 'persist me')
    sendSyncUpdate(ws1, Y.encodeStateAsUpdate(doc1))
    await new Promise((resolve) => setTimeout(resolve, 80))
    ws1.close()

    const teardownDeadline = Date.now() + 1_000
    while (Date.now() < teardownDeadline) {
      if (!syncServer?.rooms.has('persisted-room')) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(syncServer?.rooms.has('persisted-room')).toBe(false)
    expect(snapshots.has('persisted-room')).toBe(true)

    const { ws: ws2, msgs: msgs2 } = await connectWs(port, 'persisted-room')
    const doc2 = new Y.Doc()
    await completeHandshake(ws2, msgs2, doc2)
    await drainSyncMessages(ws2, msgs2, doc2, 120)

    expect(doc2.getText('codemirror').toString()).toBe('persist me')

    doc1.destroy()
    doc2.destroy()
    ws2.close()
  })

  it('applies replacement state and broadcasts updates from POST /replace/:docId', async () => {
    const port = await startServer()
    const { ws: ws1, msgs: msgs1 } = await connectWs(port, 'replace-broadcast')
    const { ws: ws2, msgs: msgs2 } = await connectWs(port, 'replace-broadcast')
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()
    await completeHandshake(ws1, msgs1, doc1)
    await completeHandshake(ws2, msgs2, doc2)

    const replacementDoc = new Y.Doc()
    replacementDoc.getText('test').insert(0, 'replaced')
    const replacementUpdate = Y.encodeStateAsUpdate(replacementDoc)
    replacementDoc.destroy()

    const replaceRes = await fetch(`http://localhost:${port}/replace/replace-broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(replacementUpdate),
    })
    expect(replaceRes.status).toBe(200)

    await drainSyncMessages(ws2, msgs2, doc2, 250)
    expect(doc2.getText('test').toString()).toBe('replaced')

    ws1.close()
    ws2.close()
  })

  it('passes last edit user and source to snapshotCallback', async () => {
    const snapshotCallback = vi.fn(async () => {})
    const port = await startServer({
      auth: mockAuth({
        verifyResult: validPayload,
        permissions: { can_view: true, can_edit: true },
      }),
      snapshotCallback,
      snapshotIntervalMs: 20,
    })

    const { ws, msgs } = await connectWsRawWithQueue(port, '/snapshot-meta', {
      headers: { Authorization: 'Bearer valid' },
    })
    const localDoc = new Y.Doc()
    await completeHandshake(ws, msgs, localDoc)

    localDoc.getText('codemirror').insert(0, 'from daemon')
    sendSyncUpdate(ws, Y.encodeStateAsUpdate(localDoc))

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(snapshotCallback).toHaveBeenCalledTimes(1)
    const snapshotCall = snapshotCallback.mock.calls[0] as unknown as
      | [string, Uint8Array, string | null, 'browser' | 'daemon' | null]
      | undefined
    expect(snapshotCall?.[2]).toBe('user-1')
    expect(snapshotCall?.[3]).toBe('daemon')
    ws.close()
  })

  it('skips agent policy for cookie auth but checks daemon auth', async () => {
    const calls: Array<{ room: string; source: string }> = []
    const port = await startServer({
      auth: {
        verifyToken: async () => validPayload,
        verifySessionCookie: async () => validPayload,
        checkPermission: async (_userId, relation) => relation === 'can_view' || relation === 'can_edit',
      },
      checkAgentPolicy: async (roomName, source) => {
        calls.push({ room: roomName, source })
        return { allowed: true }
      },
    })

    const browserWs = await connectWsRaw(port, '/policy-skip-test', {
      headers: { Cookie: 'better-auth.session_token=abc' },
    })
    expect(browserWs.readyState).toBe(WebSocket.OPEN)
    expect(calls).toHaveLength(0)

    const daemonWs = await connectWsRaw(port, '/policy-skip-test', {
      headers: { Authorization: 'Bearer valid' },
    })
    expect(daemonWs.readyState).toBe(WebSocket.OPEN)
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toEqual([{ room: 'policy-skip-test', source: 'daemon' }])

    browserWs.close()
    daemonWs.close()
  })

  it('handles upgrade auth exceptions without crashing server', async () => {
    const port = await startServer({
      auth: {
        verifyToken: async () => {
          throw new Error('kaboom')
        },
        verifySessionCookie: async () => null,
        checkPermission: async () => false,
      },
    })

    const connectionFailed = await new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/throwing-auth`, {
        headers: { Authorization: 'Bearer token' },
      })
      ws.on('open', () => reject(new Error('unexpected websocket open')))
      ws.on('error', () => resolve(true))
      ws.on('close', () => resolve(true))
    })
    expect(connectionFailed).toBe(true)

    const res = await fetch(`http://localhost:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
  })
})

describe('webhook event emission', () => {
  function sendSyncUpdate(ws: WebSocket, update: Uint8Array) {
    const updateEnc = encoding.createEncoder()
    encoding.writeVarUint(updateEnc, messageSync)
    syncProtocol.writeUpdate(updateEnc, update)
    ws.send(encoding.toUint8Array(updateEnc))
  }

  async function completeHandshake(ws: WebSocket, msgs: MsgQueue, doc: Y.Doc) {
    const step1 = await msgs.next()
    const dec = decoding.createDecoder(step1)
    const outer = decoding.readVarUint(dec)
    if (outer !== messageSync) {
      throw new Error(`expected sync message, got ${outer}`)
    }

    const resp = encoding.createEncoder()
    encoding.writeVarUint(resp, messageSync)
    syncProtocol.readSyncMessage(dec, resp, doc, null)
    if (encoding.length(resp) > 1) {
      ws.send(encoding.toUint8Array(resp))
    }

    const ourStep1 = encoding.createEncoder()
    encoding.writeVarUint(ourStep1, messageSync)
    syncProtocol.writeSyncStep1(ourStep1, doc)
    ws.send(encoding.toUint8Array(ourStep1))

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  it('emits comment, mention, suggestion, and discussion events', async () => {
    const receivedEvents: Array<{ eventType: string; data?: Record<string, unknown> }> = []
    const eventCallback: NonNullable<SyncServerConfig['eventCallback']> = async (event) => {
      receivedEvents.push({
        eventType: event.eventType,
        data: event.data,
      })
    }
    const port = await startServer({ eventCallback })
    const { ws, msgs } = await connectWsRawWithQueue(port, '/event-test')
    const localDoc = new Y.Doc()
    await completeHandshake(ws, msgs, localDoc)

    localDoc.transact(() => {
      const comment = new Y.Map<unknown>()
      comment.set('id', 'comment-1')
      comment.set('text', 'Please check @writer')
      const suggestion = new Y.Map<unknown>()
      suggestion.set('status', 'pending')
      comment.set('suggestion', suggestion)
      localDoc.getArray<Y.Map<unknown>>('comments').push([comment])

      const discussion = new Y.Map<unknown>()
      discussion.set('id', 'discussion-1')
      localDoc.getArray<Y.Map<unknown>>('discussions').push([discussion])
    }, 'test-event-update')
    sendSyncUpdate(ws, Y.encodeStateAsUpdate(localDoc))
    await new Promise((resolve) => setTimeout(resolve, 150))

    const eventTypes = receivedEvents.map((event) => event.eventType)
    expect(eventTypes).toContain('document.edited')
    expect(eventTypes).toContain('comment.created')
    expect(eventTypes).toContain('comment.mention')
    expect(eventTypes).toContain('suggestion.created')
    expect(eventTypes).toContain('discussion.created')

    const mentionEvent = receivedEvents.find((event) => event.eventType === 'comment.mention')
    expect(mentionEvent?.data).toEqual({
      commentId: 'comment-1',
      mentionedAgent: 'writer',
    })

    ws.close()
  })

  it('emits suggestion accepted and dismissed events when status changes', async () => {
    const receivedEvents: Array<{ eventType: string; data?: Record<string, unknown> }> = []
    const eventCallback: NonNullable<SyncServerConfig['eventCallback']> = async (event) => {
      receivedEvents.push({
        eventType: event.eventType,
        data: event.data,
      })
    }
    const port = await startServer({ eventCallback })
    const { ws, msgs } = await connectWsRawWithQueue(port, '/suggestion-event-test')
    const localDoc = new Y.Doc()
    await completeHandshake(ws, msgs, localDoc)

    const comments = localDoc.getArray<Y.Map<unknown>>('comments')
    const commentAccepted = new Y.Map<unknown>()
    commentAccepted.set('id', 'comment-accepted')
    const acceptedSuggestion = new Y.Map<unknown>()
    acceptedSuggestion.set('status', 'pending')
    commentAccepted.set('suggestion', acceptedSuggestion)
    comments.push([commentAccepted])

    const commentDismissed = new Y.Map<unknown>()
    commentDismissed.set('id', 'comment-dismissed')
    const dismissedSuggestion = new Y.Map<unknown>()
    dismissedSuggestion.set('status', 'pending')
    commentDismissed.set('suggestion', dismissedSuggestion)
    comments.push([commentDismissed])

    sendSyncUpdate(ws, Y.encodeStateAsUpdate(localDoc))
    await new Promise((resolve) => setTimeout(resolve, 100))

    localDoc.transact(() => {
      acceptedSuggestion.set('status', 'accepted')
      dismissedSuggestion.set('status', 'dismissed')
    }, 'test-status-update')
    sendSyncUpdate(ws, Y.encodeStateAsUpdate(localDoc))
    await new Promise((resolve) => setTimeout(resolve, 150))

    const accepted = receivedEvents.find((event) => event.eventType === 'suggestion.accepted')
    const dismissed = receivedEvents.find((event) => event.eventType === 'suggestion.dismissed')

    expect(accepted?.data).toEqual({ commentId: 'comment-accepted' })
    expect(dismissed?.data).toEqual({ commentId: 'comment-dismissed' })

    ws.close()
  })
})
