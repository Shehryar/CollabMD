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

  const fetchTrash = useCallback(async () => {
    try {
      const res = await fetch('/api/documents/trash')
      if (res.ok) {
        setDocs(await res.json())
      }
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
    const res = await fetch(`/api/documents/${id}/restore`, { method: 'POST' })
    if (res.ok) {
      setDocs((prev) => prev.filter((d) => d.id !== id))
    }
  }

  const deletePermanently = async (id: string) => {
    if (!window.confirm('Permanently delete this document? This cannot be undone.')) return
    const res = await fetch(`/api/documents/${id}/permanent`, { method: 'DELETE' })
    if (res.ok) {
      setDocs((prev) => prev.filter((d) => d.id !== id))
    }
  }

  if (isPending || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Trash</h1>
        <p className="text-sm text-gray-500">
          Deleted documents are permanently removed after 30 days
        </p>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">Trash is empty</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                {doc.title}
              </span>
              <span className="shrink-0 text-xs text-gray-400">
                {daysRemaining(doc.deletedAt)}d remaining
              </span>
              <button
                onClick={() => restore(doc.id)}
                className="shrink-0 text-xs text-blue-500 hover:text-blue-700"
              >
                Restore
              </button>
              <button
                onClick={() => deletePermanently(doc.id)}
                className="shrink-0 text-xs text-red-400 hover:text-red-600"
              >
                Delete permanently
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
