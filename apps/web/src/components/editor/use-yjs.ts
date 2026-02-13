import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'

const WS_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:4444'

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
  awareness: Awareness
  synced: boolean
}

export function useYjs(docId: string): YjsContext {
  const core = useMemo(() => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
    const awareness = new Awareness(ydoc)

    const color = pickColor()
    awareness.setLocalStateField('user', {
      name: pickName(),
      color,
      colorLight: color + '33',
    })
    awareness.setLocalStateField('source', 'browser')

    return { ydoc, ytext, ycomments, awareness }
  }, [docId])

  const [synced, setSynced] = useState(false)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const contextRef = useRef<YjsContext | null>(null)

  // Connect to sync server (useEffect only runs client-side)
  useEffect(() => {
    const provider = new WebsocketProvider(WS_URL, docId, core.ydoc, {
      awareness: core.awareness,
    })
    providerRef.current = provider

    provider.on('sync', (isSynced: boolean) => setSynced(isSynced))

    return () => {
      provider.destroy()
      core.awareness.destroy()
      core.ydoc.destroy()
      providerRef.current = null
      setSynced(false)
    }
  }, [docId, core])

  if (!contextRef.current || contextRef.current.ydoc !== core.ydoc) {
    contextRef.current = { ...core, synced: false }
  }
  contextRef.current.synced = synced
  return contextRef.current
}
