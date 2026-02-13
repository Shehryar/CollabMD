'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from '@/lib/auth-client'

interface TrashedDoc {
  id: string
  title: string
  deletedAt: string
}

function daysRemaining(deletedAt: string): number {
  const deleted = new Date(deletedAt).getTime()
  const expiry = deleted + 30 * 24 * 60 * 60 * 1000
  const remaining = Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000))
  return Math.max(0, remaining)
}

export default function TrashPage() {
  const { data: session, isPending } = useSession()
  const [docs, setDocs] = useState<TrashedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchTrash = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/documents/trash')
      if (!res.ok) {
        setError('Failed to load trash.')
        return
      }
      setDocs(await res.json())
    } catch {
      setError('Failed to load trash.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) {
      fetchTrash()
    } else if (!isPending) {
      setLoading(false)
    }
  }, [session, isPending, fetchTrash])

  const restore = async (id: string) => {
    if (restoringId || deletingId) return
    setRestoringId(id)
    setError(null)
    try {
      const res = await fetch(`/api/documents/${id}/restore`, { method: 'POST' })
      if (!res.ok) {
        setError('Failed to restore document.')
        return
      }
      window.dispatchEvent(new Event('collabmd:documents-changed'))
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch {
      setError('Failed to restore document.')
    } finally {
      setRestoringId(null)
    }
  }

  const deletePermanently = async (id: string) => {
    if (restoringId || deletingId) return
    if (!window.confirm('Permanently delete this document? This cannot be undone.')) return
    setDeletingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/documents/${id}/permanent`, { method: 'DELETE' })
      if (!res.ok) {
        setError('Failed to permanently delete document.')
        return
      }
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch {
      setError('Failed to permanently delete document.')
    } finally {
      setDeletingId(null)
    }
  }

  if (isPending || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-sm text-fg-muted">Loading...</div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="border-b border-border px-7 pb-3 pt-4">
        <h1 className="font-mono text-[18px] font-semibold tracking-[-0.03em] text-fg">Trash</h1>
        <p className="mt-1 font-sans text-sm text-fg-secondary">
          Deleted documents are permanently removed after 30 days
        </p>
      </div>
      {error && (
        <div className="mx-7 mt-4 rounded bg-red-subtle px-3 py-2 text-sm text-red">{error}</div>
      )}

      <div className="px-5 pt-4">
        {docs.length === 0 ? (
          <div className="rounded border border-dashed border-border p-8 text-center">
            <p className="font-sans text-sm text-fg-muted">Trash is empty</p>
          </div>
        ) : (
          <ul>
            {docs.map((doc) => (
              <li key={doc.id} className="group flex items-center gap-3 rounded border border-transparent px-3 py-[10px] hover:border-border hover:bg-bg-subtle">
                {/* Doc icon */}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-bg-subtle font-mono text-sm text-fg-muted group-hover:border-border-strong group-hover:bg-bg">
                  #
                </div>
                <span className="min-w-0 flex-1 truncate font-sans text-[13.5px] font-medium tracking-[-0.01em] text-fg">
                  {doc.title}
                </span>
                <span className="shrink-0 rounded-sm bg-red-subtle px-[7px] py-[2px] font-mono text-[10px] font-medium tracking-[0.02em] text-red">
                  trashed
                </span>
                <span className="shrink-0 font-mono text-[11px] tracking-[-0.01em] text-fg-faint">
                  {daysRemaining(doc.deletedAt)}d remaining
                </span>
                <button
                  onClick={() => void restore(doc.id)}
                  disabled={restoringId === doc.id || deletingId === doc.id}
                  className="shrink-0 font-mono text-[11px] text-accent hover:text-accent-hover disabled:opacity-50"
                >
                  {restoringId === doc.id ? 'Restoring...' : 'Restore'}
                </button>
                <button
                  onClick={() => void deletePermanently(doc.id)}
                  disabled={restoringId === doc.id || deletingId === doc.id}
                  className="shrink-0 font-mono text-[11px] text-fg-muted hover:text-red disabled:opacity-50"
                >
                  {deletingId === doc.id ? 'Deleting...' : 'Delete permanently'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
