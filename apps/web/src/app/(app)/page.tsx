'use client'

import { useSession } from '@/lib/auth-client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useSidebar, type Folder } from '@/components/sidebar/sidebar-context'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { LandingHero } from '@/components/landing/hero'

interface Doc {
  id: string
  title: string
  orgId: string
  ownerId: string
  folderId: string | null
  source?: string | null
  updatedAt: string
  createdAt: string
}

type SortField = 'updatedAt' | 'title' | 'createdAt'
type ViewMode = 'list' | 'grid'

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
  busyRename,
  busyDelete,
  busyMove,
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
  busyRename: boolean
  busyDelete: boolean
  busyMove: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: doc.id,
    data: { title: doc.title },
  })
  const [moveOpen, setMoveOpen] = useState(false)
  const moveRef = useRef<HTMLDivElement>(null)
  const moveMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!moveOpen) return
    function handleClick(e: MouseEvent) {
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) {
        setMoveOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMoveOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [moveOpen])

  useEffect(() => {
    if (!moveOpen) return
    const timer = setTimeout(() => {
      moveMenuItemRefs.current[0]?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [moveOpen])

  const focusMoveItem = (index: number) => {
    const count = folders.length + 1
    const normalized = (index + count) % count
    moveMenuItemRefs.current[normalized]?.focus()
  }

  const handleMoveMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!moveOpen) return
    const current = moveMenuItemRefs.current.findIndex((el) => el === document.activeElement)
    const active = current === -1 ? 0 : current

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusMoveItem(active + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusMoveItem(active - 1)
        break
      case 'Home':
        e.preventDefault()
        focusMoveItem(0)
        break
      case 'End':
        e.preventDefault()
        focusMoveItem(folders.length)
        break
      case 'Escape':
        e.preventDefault()
        setMoveOpen(false)
        break
    }
  }

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.5 : 1 }
    : undefined

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 rounded border border-transparent px-3 py-[10px] hover:border-border hover:bg-bg-subtle"
      aria-dropeffect="move"
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="shrink-0 cursor-grab touch-none text-fg-faint opacity-0 transition-opacity hover:text-fg-muted group-hover:opacity-100"
        title="Drag to move"
        aria-label="Drag to reorder"
        aria-grabbed={isDragging}
        aria-dropeffect="move"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
        </svg>
      </button>
      {/* Doc icon */}
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-bg-subtle font-mono text-sm text-fg-muted group-hover:border-border-strong group-hover:bg-bg">
        #
        {doc.source === 'daemon' && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-bg" title="Synced from local">
            <svg className="h-2.5 w-2.5 text-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
          </span>
        )}
      </div>
      {renamingId === doc.id ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded border border-border px-2 py-1 font-mono text-xs text-fg focus:border-fg focus:outline-none"
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
          className="min-w-0 flex-1 truncate font-sans text-[13.5px] font-medium tracking-[-0.01em] text-fg"
        >
          {doc.title}
        </Link>
      )}
      {/* Right side: date (default) / actions (hover) */}
      <span className="ml-auto shrink-0 font-mono text-[11px] tracking-[-0.01em] text-fg-faint group-hover:hidden">
        {new Date(doc.updatedAt).toLocaleDateString()}
      </span>
      <div className="ml-auto hidden shrink-0 items-center gap-3 group-hover:flex">
        <button
          onClick={() => {
            setRenamingId(doc.id)
            setRenameValue(doc.title)
          }}
          disabled={busyRename}
          className="font-mono text-[11px] text-fg-muted hover:text-fg"
        >
          {busyRename ? 'Renaming...' : 'Rename'}
        </button>
        {/* Move to... dropdown */}
        <div ref={moveRef} className="relative">
          <button
            onClick={() => setMoveOpen(!moveOpen)}
            disabled={busyMove}
            className="font-mono text-[11px] text-fg-muted hover:text-fg"
            aria-haspopup="menu"
            aria-expanded={moveOpen}
            aria-label="move document"
          >
            {busyMove ? 'Moving...' : 'Move'}
          </button>
          {moveOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-44 rounded border border-border bg-bg py-1 shadow"
              role="menu"
              aria-label="move document"
              onKeyDown={handleMoveMenuKeyDown}
            >
              <button
                ref={(el) => {
                  moveMenuItemRefs.current[0] = el
                }}
                onClick={() => {
                  moveDoc(doc.id, null)
                  setMoveOpen(false)
                }}
                className={`flex w-full px-3 py-1.5 text-left text-sm hover:bg-bg-hover ${
                  !doc.folderId ? 'font-medium text-fg' : 'text-fg-secondary'
                }`}
                role="menuitem"
                tabIndex={-1}
              >
                Root (no folder)
              </button>
              {folders.map((f, index) => (
                <button
                  key={f.id}
                  ref={(el) => {
                    moveMenuItemRefs.current[index + 1] = el
                  }}
                  onClick={() => {
                    moveDoc(doc.id, f.id)
                    setMoveOpen(false)
                  }}
                  className={`flex w-full px-3 py-1.5 text-left text-sm hover:bg-bg-hover ${
                    doc.folderId === f.id ? 'font-medium text-fg' : 'text-fg-secondary'
                  }`}
                  role="menuitem"
                  tabIndex={-1}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => deleteDoc(doc.id)}
          disabled={busyDelete}
          className="font-mono text-[11px] text-fg-muted hover:text-red"
        >
          {busyDelete ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </li>
  )
}

export default function HomePage() {
  const { data: session, isPending } = useSession()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { folders, connectedFolders, onboardingStatus, onboardingLoading, refreshOnboardingStatus } = useSidebar()

  const folderId = searchParams.get('folder')
  const view = searchParams.get('view')
  const searchQuery = searchParams.get('search') ?? ''

  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortField>('updatedAt')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('collabmd:view-mode') as ViewMode) || 'list'
    }
    return 'list'
  })
  const [searchInput, setSearchInput] = useState(searchQuery)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const [movingDocId, setMovingDocId] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    if (onboardingLoading || !onboardingStatus) return

    const completedKey = `collabmd:onboarding-completed:${onboardingStatus.orgId}`
    const completed = localStorage.getItem(completedKey) === '1'
    const shouldShow = onboardingStatus.docCount === 0 && onboardingStatus.memberCount <= 1 && !completed
    setShowOnboarding(shouldShow)
  }, [onboardingLoading, onboardingStatus])

  const fetchDocs = useCallback(async () => {
    const params = new URLSearchParams()
    if (folderId) params.set('folderId', folderId)
    if (view === 'shared') params.set('shared', 'true')
    if (searchQuery) params.set('search', searchQuery)
    const qs = params.toString()
    setError(null)
    try {
      const res = await fetch(`/api/documents${qs ? `?${qs}` : ''}`)
      if (!res.ok) {
        setError('Failed to load documents.')
        return
      }
      setDocs(await res.json())
    } catch {
      setError('Failed to load documents.')
    } finally {
      setLoading(false)
    }
  }, [folderId, view, searchQuery])

  useEffect(() => {
    if (session) {
      setLoading(true)
      void fetchDocs()
    } else if (!isPending) {
      setLoading(false)
    }
  }, [session, isPending, fetchDocs])

  useEffect(() => {
    const onChanged = () => {
      void fetchDocs()
    }
    window.addEventListener('collabmd:documents-changed', onChanged)
    return () => window.removeEventListener('collabmd:documents-changed', onChanged)
  }, [fetchDocs])

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
    if (creatingDoc) return
    const activeOrgId = session?.session?.activeOrganizationId
    if (!activeOrgId) return
    setCreatingDoc(true)
    setError(null)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', orgId: activeOrgId, folderId }),
      })
      if (!res.ok) {
        setError('Failed to create document.')
        return
      }
      const doc = await res.json()
      await refreshOnboardingStatus()
      router.push(`/doc/${doc.id}`)
    } catch {
      setError('Failed to create document.')
    } finally {
      setCreatingDoc(false)
    }
  }

  const renameDoc = async (id: string) => {
    if (renamingDocId) return
    if (!renameValue.trim()) {
      setRenamingId(null)
      return
    }
    setRenamingDocId(id)
    setError(null)
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      })
      if (!res.ok) {
        setError('Failed to rename document.')
        return
      }
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, title: renameValue.trim() } : d)))
    } catch {
      setError('Failed to rename document.')
    } finally {
      setRenamingDocId(null)
      setRenamingId(null)
    }
  }

  const deleteDoc = async (id: string) => {
    if (deletingDocId) return
    setDeletingDocId(id)
    setError(null)
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        setError('Failed to delete document.')
        return
      }
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch {
      setError('Failed to delete document.')
    } finally {
      setDeletingDocId(null)
    }
  }

  const moveDoc = async (docId: string, targetFolderId: string | null) => {
    if (movingDocId) return
    setMovingDocId(docId)
    setError(null)
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: targetFolderId }),
      })
      if (!res.ok) {
        setError('Failed to move document.')
        return
      }
      setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, folderId: targetFolderId } : d)))
    } catch {
      setError('Failed to move document.')
    } finally {
      setMovingDocId(null)
    }
  }

  const childFolders = useMemo(() => {
    if (!folderId) return []
    return folders.filter((f) => f.parentId === folderId)
  }, [folderId, folders])

  const connectedFoldersById = useMemo(() => {
    return new Map(
      connectedFolders
        .map((folder) => [folder.folderId, folder] as const)
        .filter((entry): entry is readonly [string, (typeof connectedFolders)[number]] => entry[0] !== null),
    )
  }, [connectedFolders])

  const connectedFolderIds = useMemo(() => {
    return new Set(connectedFoldersById.keys())
  }, [connectedFoldersById])

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
    : 'All documents'

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-sm text-fg-muted">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-bg-subtle">
        <LandingHero />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Breadcrumb */}
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1 px-7 pt-4 font-mono text-[11px] text-fg-muted">
          <Link href="/" className="hover:text-fg">Documents</Link>
          {breadcrumb.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <span>/</span>
              <Link href={`/?folder=${f.id}`} className="hover:text-fg">
                {f.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      {/* Sync status bar */}
      {folderId && breadcrumb && (() => {
        const currentFolder = breadcrumb[breadcrumb.length - 1]
        const syncInfo = currentFolder ? connectedFoldersById.get(currentFolder.id) : undefined
        if (!syncInfo) return null
        return (
          <div className="mx-7 mt-2 flex items-center gap-2 rounded border border-border bg-bg-subtle px-3 py-1.5">
            <span className={`inline-block h-[6px] w-[6px] rounded-full ${syncInfo.status === 'synced' ? 'bg-green' : 'bg-fg-faint'}`} />
            <span className="font-mono text-[11px] text-fg-secondary">
              {syncInfo.status === 'synced' ? 'Synced' : 'Disconnected'}
            </span>
            <span className="text-fg-faint">·</span>
            <span className="font-mono text-[11px] text-fg-faint">{syncInfo.fileCount} files</span>
            <span className="text-fg-faint">·</span>
            <span className="font-mono text-[11px] text-fg-faint">
              Last sync {new Date(syncInfo.lastSync).toLocaleString()}
            </span>
          </div>
        )
      })()}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-7 pb-3 pt-4">
        <h1 className="font-mono text-[18px] font-semibold tracking-[-0.03em] text-fg">{pageTitle}</h1>
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="search docs..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-[200px] rounded border border-border bg-bg px-[10px] py-[6px] font-mono text-xs text-fg placeholder:text-fg-faint focus:border-fg focus:outline-none"
            />
          </form>
          <button
            onClick={() => {
              const fields: SortField[] = ['updatedAt', 'title', 'createdAt']
              const idx = fields.indexOf(sort)
              const next = (idx + 1) % fields.length
              setSort(fields[next])
            }}
            className="rounded border border-border bg-bg px-[10px] py-[6px] font-mono text-[11px] text-fg-secondary hover:border-fg hover:text-fg"
          >
            sort: {sort === 'updatedAt' ? 'updated' : sort === 'createdAt' ? 'created' : 'name'} &#9662;
          </button>
          <button
            onClick={() => {
              const next = viewMode === 'list' ? 'grid' : 'list'
              setViewMode(next)
              localStorage.setItem('collabmd:view-mode', next)
            }}
            className="rounded border border-border bg-bg p-[6px] text-fg-secondary hover:border-fg hover:text-fg"
            title={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          >
            {viewMode === 'list' ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error && (
        <div className="mx-7 mt-4 rounded bg-red-subtle px-3 py-2 text-sm text-red">{error}</div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pt-2">
        {loading ? (
          <div className="px-3 py-4 font-mono text-sm text-fg-muted">Loading documents...</div>
        ) : sortedDocs.length === 0 && childFolders.length === 0 ? (
          <div className="rounded border border-dashed border-border p-8 text-center">
            <p className="font-sans text-sm text-fg-muted">
              {searchQuery ? 'No documents match your search' : 'No documents yet'}
            </p>
            {!searchQuery && view !== 'shared' && (
              <button
                onClick={createDoc}
                className="mt-2 font-mono text-sm text-accent hover:text-accent-hover"
              >
                Create your first document
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <>
            {/* Grid: sub-folders */}
            {childFolders.length > 0 && (
              <div className="mb-4 px-1 pt-1">
                {sortedDocs.length > 0 && (
                  <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-fg-faint">Folders</p>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {childFolders.map((cf) => (
                    <Link
                      key={cf.id}
                      href={`/?folder=${cf.id}`}
                      className="flex items-center gap-2.5 rounded-lg border border-border px-3.5 py-3 transition-colors hover:border-border-strong hover:bg-bg-subtle"
                    >
                      <svg className="h-5 w-5 shrink-0 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.06-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                      </svg>
                      <span className="truncate font-sans text-[13px] font-medium text-fg">{cf.name}</span>
                      {connectedFolderIds.has(cf.id) && (
                        <svg className="ml-auto h-3 w-3 shrink-0 text-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                        </svg>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {/* Grid: documents */}
            {sortedDocs.length > 0 && (
              <div className="px-1">
                {childFolders.length > 0 && (
                  <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-fg-faint">Documents</p>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {sortedDocs.map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/doc/${doc.id}`}
                      className="group flex flex-col gap-2 rounded-lg border border-border p-3.5 transition-colors hover:border-border-strong hover:bg-bg-subtle"
                    >
                      <div className="relative flex h-8 w-8 items-center justify-center rounded border border-border bg-bg-subtle font-mono text-sm text-fg-muted">
                        #
                        {doc.source === 'daemon' && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-bg">
                            <svg className="h-2.5 w-2.5 text-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <span className="truncate font-sans text-[13px] font-medium text-fg">{doc.title}</span>
                      <span className="font-mono text-[10px] text-fg-faint">
                        {new Date(doc.updatedAt).toLocaleDateString()}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* List: sub-folders */}
            {childFolders.length > 0 && (
              <ul className={sortedDocs.length > 0 ? 'mb-1' : ''}>
                {childFolders.map((cf) => (
                  <li key={cf.id}>
                    <Link
                      href={`/?folder=${cf.id}`}
                      className="group flex items-center gap-3 rounded border border-transparent px-3 py-[10px] hover:border-border hover:bg-bg-subtle"
                    >
                      <svg className="h-5 w-5 shrink-0 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.06-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                      </svg>
                      <span className="min-w-0 flex-1 truncate font-sans text-[13.5px] font-medium text-fg">{cf.name}</span>
                      {connectedFolderIds.has(cf.id) && (
                        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-fg-faint group-hover:hidden">
                          <svg className="h-2.5 w-2.5 text-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                          </svg>
                          local
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {/* List: documents */}
            {sortedDocs.length > 0 && (
              <ul>
                {sortedDocs.map((doc) => (
                  <DraggableDocRow
                    key={doc.id}
                    doc={doc}
                    renamingId={renamingId}
                    renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    setRenamingId={setRenamingId}
                    renameDoc={(id) => void renameDoc(id)}
                    deleteDoc={(id) => void deleteDoc(id)}
                    moveDoc={(docId, nextFolderId) => void moveDoc(docId, nextFolderId)}
                    folders={folders}
                    busyRename={renamingDocId === doc.id}
                    busyDelete={deletingDocId === doc.id}
                    busyMove={movingDocId === doc.id}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {onboardingStatus && (
        <OnboardingWizard
          open={showOnboarding}
          orgId={onboardingStatus.orgId}
          orgName={onboardingStatus.orgName}
          onRefreshStatus={refreshOnboardingStatus}
          onClose={() => setShowOnboarding(false)}
        />
      )}
    </div>
  )
}
