import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'

const DEFAULT_SYNC_PORT = '4444'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function resolveSyncUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SYNC_URL?.trim()

  if (typeof window === 'undefined') {
    return configured || `ws://localhost:${DEFAULT_SYNC_PORT}`
  }

  const browserProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const browserHost = window.location.hostname
  const fallback = `${browserProtocol}//${browserHost}:${DEFAULT_SYNC_PORT}`

  if (!configured) return fallback

  try {
    const url = new URL(configured)

    // In dev, if sync URL is loopback but app is opened via LAN/IP host,
    // align websocket hostname with the browser host so auth cookies match.
    if (isLoopbackHost(url.hostname) && !isLoopbackHost(browserHost)) {
      url.hostname = browserHost
    }

    if (browserProtocol === 'wss:' && url.protocol === 'ws:') {
      url.protocol = 'wss:'
    }

    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

const COLORS = [
  '#30bced',
  '#6eeb83',
  '#ffbc42',
  '#e84855',
  '#8458B3',
  '#0095ff',
  '#ff6b6b',
  '#54c7ec',
]

function pickColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

function pickColorForId(id: string): string {
  let sum = 0
  for (const char of id) sum += char.charCodeAt(0)
  return COLORS[sum % COLORS.length]
}

function pickName(): string {
  const adjectives = ['Swift', 'Bold', 'Calm', 'Keen', 'Warm']
  const animals = ['Fox', 'Owl', 'Bear', 'Hawk', 'Wolf']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const animal = animals[Math.floor(Math.random() * animals.length)]
  return `${adj} ${animal}`
}

export interface YjsContext {
  ydoc: Y.Doc
  ytext: Y.Text
  ycomments: Y.Array<Y.Map<unknown>>
  ydiscussions: Y.Array<Y.Map<unknown>>
  awareness: Awareness
  synced: boolean
  connectionStatus: 'connected' | 'connecting' | 'disconnected'
  syncUrl: string
}

export interface UseYjsOptions {
  user?: { id: string; name: string }
}

export function useYjs(docId: string, options?: UseYjsOptions): YjsContext {
  const userId = options?.user?.id
  const userName = options?.user?.name
  const core = useMemo(() => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
    const ydiscussions = ydoc.getArray<Y.Map<unknown>>('discussions')
    const awareness = new Awareness(ydoc)

    const color = userId ? pickColorForId(userId) : pickColor()
    awareness.setLocalStateField(
      'user',
      userId && userName
        ? {
            name: userName,
            id: userId,
            color,
            colorLight: color + '33',
          }
        : {
            name: pickName(),
            color,
            colorLight: color + '33',
          },
    )
    awareness.setLocalStateField('source', 'browser')

    return { ydoc, ytext, ycomments, ydiscussions, awareness }
  }, [docId])

  const [synced, setSynced] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'connecting' | 'disconnected'
  >('disconnected')
  const providerRef = useRef<WebsocketProvider | null>(null)
  const contextRef = useRef<YjsContext | null>(null)
  const syncUrl = useMemo(() => resolveSyncUrl(), [])

  useEffect(() => {
    if (!userId || !userName) return

    const color = pickColorForId(userId)
    core.awareness.setLocalStateField('user', {
      name: userName,
      id: userId,
      color,
      colorLight: color + '33',
    })
  }, [core.awareness, userId, userName])

  // Connect to sync server (useEffect only runs client-side)
  useEffect(() => {
    const provider = new WebsocketProvider(syncUrl, docId, core.ydoc, {
      awareness: core.awareness,
    })
    providerRef.current = provider

    provider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
      setConnectionStatus(event.status)
    })
    provider.on('sync', (isSynced: boolean) => setSynced(isSynced))

    return () => {
      provider.destroy()
      core.awareness.destroy()
      core.ydoc.destroy()
      providerRef.current = null
      setSynced(false)
      setConnectionStatus('disconnected')
    }
  }, [docId, core, syncUrl])

  if (!contextRef.current || contextRef.current.ydoc !== core.ydoc) {
    contextRef.current = {
      ...core,
      synced: false,
      connectionStatus: 'disconnected',
      syncUrl,
    }
  }
  contextRef.current.synced = synced
  contextRef.current.connectionStatus = connectionStatus
  contextRef.current.syncUrl = syncUrl
  return contextRef.current
}
