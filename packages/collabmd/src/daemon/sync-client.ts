import WebSocket from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { EventEmitter } from 'events'

const messageSync = 0
const messageAwareness = 1

export class SyncClient extends EventEmitter {
  private ws: WebSocket | null = null
  private serverUrl: string
  private docId: string
  private ydoc: Y.Doc
  private awareness: awarenessProtocol.Awareness
  private token: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private shouldReconnect = true
  private _synced = false
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null

  constructor(options: {
    serverUrl: string
    docId: string
    ydoc: Y.Doc
    awareness: awarenessProtocol.Awareness
    token: string
    userName?: string
  }) {
    super()
    this.serverUrl = options.serverUrl
    this.docId = options.docId
    this.ydoc = options.ydoc
    this.awareness = options.awareness
    this.token = options.token

    this.awareness.setLocalStateField('user', {
      name: options.userName || '[Agent]',
      color: '#888888',
      colorLight: '#88888833',
    })
    this.awareness.setLocalStateField('source', 'daemon')
  }

  get synced(): boolean {
    return this._synced
  }

  connect(): void {
    if (this.ws) return

    const wsUrl = this.serverUrl.replace(/^http/, 'ws')
    const url = `${wsUrl}/${this.docId}`

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'x-collabmd-source': 'daemon',
      },
    })
    this.ws.binaryType = 'arraybuffer'

    this.ws.on('open', () => {
      this.reconnectDelay = 1000
      this.updateHandler = (update: Uint8Array, origin: unknown) => {
        if (origin === 'remote') return
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeUpdate(encoder, update)
        this.send(encoder)
      }
      this.ydoc.on('update', this.updateHandler)
    })

    this.ws.on('message', (data: ArrayBuffer) => {
      const msg = new Uint8Array(data)
      const decoder = decoding.createDecoder(msg)
      const messageType = decoding.readVarUint(decoder)

      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageSync)
          const syncMessageType = syncProtocol.readSyncMessage(
            decoder,
            encoder,
            this.ydoc,
            'remote',
          )
          if (encoding.length(encoder) > 1) {
            this.send(encoder)
          }
          // After receiving SyncStep1 from server, also send our own SyncStep1
          if (syncMessageType === 0) {
            const step1Encoder = encoding.createEncoder()
            encoding.writeVarUint(step1Encoder, messageSync)
            syncProtocol.writeSyncStep1(step1Encoder, this.ydoc)
            this.send(step1Encoder)
          }
          // After receiving SyncStep2 from server, sync is complete
          if (syncMessageType === 1) {
            this._synced = true
            this.emit('synced')
          }
          break
        }
        case messageAwareness: {
          const update = decoding.readVarUint8Array(decoder)
          awarenessProtocol.applyAwarenessUpdate(this.awareness, update, 'remote')
          break
        }
      }
    })

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.cleanup()
      this._synced = false

      if (code === 4403 || code === 4029 || code === 4450 || code === 4451) {
        this.shouldReconnect = false
        this.emit('error', new Error(`Connection refused: ${code} ${reason.toString()}`))
        return
      }

      this.emit('disconnected')
      this.scheduleReconnect()
    })

    this.ws.on('error', (err: Error) => {
      this.emit('error', err)
    })
  }

  private send(encoder: encoding.Encoder): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encoding.toUint8Array(encoder))
    }
  }

  private cleanup(): void {
    if (this.updateHandler) {
      this.ydoc.off('update', this.updateHandler)
      this.updateHandler = null
    }
    this.ws = null
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    if (this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  updateToken(token: string): void {
    this.token = token
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.cleanup()
    }
    this._synced = false
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
