'use client'

import { useSession, signOut } from '@/lib/auth-client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

interface Doc {
  id: string
  title: string
  orgId: string
  updatedAt: string
}

export default function Home() {
  const { data: session, isPending } = useSession()
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch('/api/documents')
      if (res.ok) {
        setDocs(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) {
      fetchDocs()
    } else if (!isPending) {
      setLoading(false)
    }
  }, [session, isPending, fetchDocs])

  const createDoc = async () => {
    const activeOrgId = session?.session?.activeOrganizationId
    if (!activeOrgId) return

    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', orgId: activeOrgId }),
    })
    if (res.ok) {
      const doc = await res.json()
      router.push(`/doc/${doc.id}`)
    }
  }

  const renameDoc = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null)
      return
    }
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: renameValue.trim() }),
    })
    if (res.ok) {
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, title: renameValue.trim() } : d)))
    }
    setRenamingId(null)
  }

  const deleteDoc = async (id: string) => {
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setDocs((prev) => prev.filter((d) => d.id !== id))
    }
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Loading...</div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-2 text-2xl font-bold text-gray-900">CollabMD</h1>
          <p className="mb-6 text-sm text-gray-500">
            Collaborative markdown editing for everyone
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Get started
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CollabMD</h1>
            <p className="text-sm text-gray-500">
              {session.user.name || session.user.email}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={createDoc}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              New document
            </button>
            <Link
              href="/trash"
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Trash
            </Link>
            <button
              onClick={() => signOut()}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Sign out
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading documents...</div>
        ) : docs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500">No documents yet</p>
            <button
              onClick={createDoc}
              className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Create your first document
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                {renamingId === doc.id ? (
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => renameDoc(doc.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameDoc(doc.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <Link
                    href={`/doc/${doc.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:text-blue-600"
                  >
                    {doc.title}
                  </Link>
                )}
                <span className="shrink-0 text-xs text-gray-400">
                  {new Date(doc.updatedAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => {
                    setRenamingId(doc.id)
                    setRenameValue(doc.title)
                  }}
                  className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
                >
                  Rename
                </button>
                <button
                  onClick={() => deleteDoc(doc.id)}
                  className="shrink-0 text-xs text-red-400 hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
