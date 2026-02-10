'use client'

import { useSession } from '@/lib/auth-client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useSidebar, type Folder } from '@/components/sidebar/sidebar-context'

interface Doc {
  id: string
  title: string
  orgId: string
  ownerId: string
  folderId: string | null
  updatedAt: string
  createdAt: string
}

type SortField = 'updatedAt' | 'title' | 'createdAt'

function DraggableDocRow({
  doc,
  renamingId,
  renameValue,
  setRenameValue,
  setRenamingId,
  renameDoc,
  deleteDoc,
  moveDoc,
  folders,
}: {
  doc: Doc
  renamingId: string | null
  renameValue: string
  setRenameValue: (v: string) => void
  setRenamingId: (id: string | null) => void
  renameDoc: (id: string) => void
  deleteDoc: (id: string) => void
  moveDoc: (docId: string, folderId: string | null) => void
  folders: Folder[]
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: doc.id,
    data: { title: doc.title },
  })
  const [moveOpen, setMoveOpen] = useState(false)
  const moveRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moveOpen) return
    function handleClick(e: MouseEvent) {
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) {
        setMoveOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [moveOpen])

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.5 : 1 }
    : undefined

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3"
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="shrink-0 cursor-grab touch-none text-gray-300 hover:text-gray-500"
        title="Drag to move"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
        </svg>
      </button>
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
      {/* Move to... dropdown */}
      <div ref={moveRef} className="relative">
        <button
          onClick={() => setMoveOpen(!moveOpen)}
          className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
        >
          Move
        </button>
        {moveOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
                moveDoc(doc.id, null)
                setMoveOpen(false)
              }}
              className={`flex w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                !doc.folderId ? 'font-medium text-gray-900' : 'text-gray-700'
              }`}
            >
              Root (no folder)
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  moveDoc(doc.id, f.id)
                  setMoveOpen(false)
                }}
                className={`flex w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                  doc.folderId === f.id ? 'font-medium text-gray-900' : 'text-gray-700'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={() => deleteDoc(doc.id)}
        className="shrink-0 text-xs text-red-400 hover:text-red-600"
      >
        Delete
      </button>
    </li>
  )
}

export default function HomePage() {
  const { data: session, isPending } = useSession()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { folders, refreshDocs } = useSidebar()

  const folderId = searchParams.get('folder')
  const view = searchParams.get('view')
  const searchQuery = searchParams.get('search') ?? ''

  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortField>('updatedAt')
  const [searchInput, setSearchInput] = useState(searchQuery)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const fetchDocs = useCallback(async () => {
    const params = new URLSearchParams()
    if (folderId) params.set('folderId', folderId)
    if (view === 'shared') params.set('shared', 'true')
    if (searchQuery) params.set('search', searchQuery)
    const qs = params.toString()
    const res = await fetch(`/api/documents${qs ? `?${qs}` : ''}`)
    if (res.ok) {
      setDocs(await res.json())
    }
    setLoading(false)
  }, [folderId, view, searchQuery])

  useEffect(() => {
    if (session) {
      setLoading(true)
      fetchDocs()
    } else if (!isPending) {
      setLoading(false)
    }
  }, [session, isPending, fetchDocs])

  useEffect(() => {
    setSearchInput(searchQuery)
  }, [searchQuery])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const val = searchInput.trim()
    if (val) {
      router.push(`/?search=${encodeURIComponent(val)}`)
    } else {
      router.push('/')
    }
  }

  const sortedDocs = useMemo(() => {
    return [...docs].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'createdAt') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }, [docs, sort])

  const createDoc = async () => {
    const activeOrgId = session?.session?.activeOrganizationId
    if (!activeOrgId) return
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', orgId: activeOrgId, folderId }),
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

  const moveDoc = async (docId: string, targetFolderId: string | null) => {
    const res = await fetch(`/api/documents/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: targetFolderId }),
    })
    if (res.ok) {
      setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, folderId: targetFolderId } : d)))
      await refreshDocs()
    }
  }

  const breadcrumb = useMemo(() => {
    if (!folderId) return null
    const trail: Folder[] = []
    let current = folders.find((f) => f.id === folderId)
    while (current) {
      trail.unshift(current)
      current = current.parentId ? folders.find((f) => f.id === current!.parentId) : undefined
    }
    return trail
  }, [folderId, folders])

  const pageTitle = view === 'shared'
    ? 'Shared with me'
    : searchQuery
    ? `Search: ${searchQuery}`
    : folderId
    ? breadcrumb?.[breadcrumb.length - 1]?.name ?? 'Folder'
    : 'All Documents'

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
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
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Breadcrumb */}
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-4 flex items-center gap-1 text-sm text-gray-500">
          <Link href="/" className="hover:text-gray-700">Documents</Link>
          {breadcrumb.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <span>/</span>
              <Link href={`/?folder=${f.id}`} className="hover:text-gray-700">
                {f.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">{pageTitle}</h1>
        {view !== 'shared' && (
          <button
            onClick={createDoc}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            New document
          </button>
        )}
      </div>

      {/* Search + Sort */}
      <div className="mb-4 flex items-center gap-3">
        <form onSubmit={handleSearch} className="flex-1">
          <input
            type="text"
            placeholder="Search documents..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </form>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortField)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="updatedAt">Last modified</option>
          <option value="title">Name</option>
          <option value="createdAt">Created</option>
        </select>
      </div>

      {/* Doc list */}
      {loading ? (
        <div className="text-sm text-gray-400">Loading documents...</div>
      ) : sortedDocs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">
            {searchQuery ? 'No documents match your search' : 'No documents yet'}
          </p>
          {!searchQuery && view !== 'shared' && (
            <button
              onClick={createDoc}
              className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Create your first document
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {sortedDocs.map((doc) => (
            <DraggableDocRow
              key={doc.id}
              doc={doc}
              renamingId={renamingId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              setRenamingId={setRenamingId}
              renameDoc={renameDoc}
              deleteDoc={deleteDoc}
              moveDoc={moveDoc}
              folders={folders}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
