'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { CollabEditor, useYjs } from '@/components/editor'
import { useSession } from '@/lib/auth-client'
import ShareModal from '@/components/share-modal'

interface DocPageProps {
  params: Promise<{ id: string }>
}

export default function DocPage({ params }: DocPageProps) {
  const { id } = use(params)
  const yjs = useYjs(id)
  const { data: session } = useSession()
  const [title, setTitle] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchDoc = useCallback(async () => {
    const res = await fetch(`/api/documents/${id}`, { method: 'GET' })
    if (res.ok) {
      const doc = await res.json()
      setTitle(doc.title)
    } else if (res.status === 404) {
      setNotFound(true)
    }
  }, [id])

  useEffect(() => {
    fetchDoc()
  }, [fetchDoc])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const saveTitle = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === title) {
      setEditing(false)
      return
    }
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    })
    if (res.ok) {
      setTitle(trimmed)
    }
    setEditing(false)
  }

  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="mb-2 text-lg font-medium text-gray-900">Document not found</h1>
          <a href="/" className="text-sm text-blue-600 hover:text-blue-700">
            Back to documents
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-gray-200 px-4">
        {editing ? (
          <input
            ref={inputRef}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-sm text-gray-700"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button
            onClick={() => {
              setEditValue(title ?? '')
              setEditing(true)
            }}
            className="text-sm text-gray-700 hover:text-gray-900"
          >
            {title ?? id}
          </button>
        )}
        <span className="ml-auto flex items-center gap-3">
          {session && (
            <button
              onClick={() => setShareOpen(true)}
              className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Share
            </button>
          )}
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${yjs.synced ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`}
            />
            {yjs.synced ? 'synced' : 'connecting'}
          </span>
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <CollabEditor yjs={yjs} />
      </main>
      <ShareModal docId={id} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}
