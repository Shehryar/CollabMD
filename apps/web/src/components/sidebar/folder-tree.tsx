'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useActiveOrganization } from '@/lib/auth-client'
import { useSidebar, type Folder, type ConnectedFolder } from './sidebar-context'
import { SortableFolderRow } from './sortable-folder'
import { SortableDocRow } from './sortable-doc'
import { sortByPosition } from './folder-tree-utils'

export { sortByPosition, wouldCreateCircle } from './folder-tree-utils'

function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function statusDotClass(status: ConnectedFolder['status']): string {
  switch (status) {
    case 'synced':
      return 'bg-green'
    case 'syncing':
      return 'bg-accent animate-pulse'
    case 'disconnected':
      return 'bg-fg-faint'
  }
}

function statusLabel(status: ConnectedFolder['status']): string {
  switch (status) {
    case 'synced':
      return 'synced'
    case 'syncing':
      return 'syncing'
    case 'disconnected':
      return 'disconnected'
  }
}

export interface SidebarDoc {
  id: string
  title: string
  folderId: string | null
  position?: number
}

export function FolderTree() {
  const { folders, connectedFolders, refreshFolders, setOpen } = useSidebar()
  const { data: activeOrg } = useActiveOrganization()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeFolderId = searchParams.get('folder')
  const activeDocId = pathname.startsWith('/doc/') ? pathname.split('/')[2] : null

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState<string | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docs, setDocs] = useState<SidebarDoc[]>([])
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const contextMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const navigateToFolder = (folderId: string) => {
    router.push(`/?folder=${folderId}`)
    setOpen(false)
  }

  const sortedRootFolders = useMemo(
    () =>
      sortByPosition(
        folders.filter((f) => !f.parentId),
        (f) => f.name,
      ),
    [folders],
  )
  const rootDocs = useMemo(
    () =>
      sortByPosition(
        docs.filter((doc) => !doc.folderId),
        (d) => d.title,
      ),
    [docs],
  )
  const connectedFolderIds = useMemo(() => {
    return new Set(
      connectedFolders.map((folder) => folder.folderId).filter((id): id is string => id !== null),
    )
  }, [connectedFolders])

  const getChildren = useCallback(
    (parentId: string) =>
      sortByPosition(
        folders.filter((f) => f.parentId === parentId),
        (f) => f.name,
      ),
    [folders],
  )
  const getDocsForFolder = useCallback(
    (folderId: string) =>
      sortByPosition(
        docs.filter((doc) => doc.folderId === folderId),
        (d) => d.title,
      ),
    [docs],
  )

  const refreshDocs = useCallback(async () => {
    if (!activeOrg?.id) {
      setDocs([])
      return
    }
    try {
      const res = await fetch('/api/documents', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as unknown
      if (!Array.isArray(body)) return
      const nextDocs: SidebarDoc[] = body
        .filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        )
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          title: typeof item.title === 'string' && item.title.trim() ? item.title : 'Untitled',
          folderId: typeof item.folderId === 'string' ? item.folderId : null,
          position: typeof item.position === 'number' ? item.position : 0,
        }))
        .filter((doc) => doc.id.length > 0)
      setDocs(nextDocs)
    } catch {
      // Keep existing state when refresh fails.
    }
  }, [activeOrg?.id])

  useEffect(() => {
    void refreshDocs()
  }, [refreshDocs])

  useEffect(() => {
    const onDocumentsChanged = () => {
      void refreshDocs()
    }

    const onDocumentCreated = (event: Event) => {
      const detail = (event as CustomEvent<SidebarDoc>).detail
      if (!detail || typeof detail.id !== 'string' || !detail.id) return
      setDocs((prev) => {
        const existingIndex = prev.findIndex((doc) => doc.id === detail.id)
        if (existingIndex === -1) return [detail, ...prev]
        const next = [...prev]
        next[existingIndex] = detail
        return next
      })
    }

    window.addEventListener('collabmd:documents-changed', onDocumentsChanged)
    window.addEventListener('collabmd:document-created', onDocumentCreated)
    return () => {
      window.removeEventListener('collabmd:documents-changed', onDocumentsChanged)
      window.removeEventListener('collabmd:document-created', onDocumentCreated)
    }
  }, [refreshDocs])

  const createFolder = async (parentId: string | null) => {
    if (busy) return
    const name = createValue.trim()
    if (!name || !activeOrg?.id) {
      setCreating(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, orgId: activeOrg.id, parentId }),
      })
      if (!res.ok) {
        setError('Failed to create folder.')
        setCreating(null)
        return
      }
      setCreateValue('')
      setCreating(null)
      await refreshFolders()
    } catch {
      setError('Failed to create folder.')
      setCreating(null)
    } finally {
      setBusy(false)
    }
  }

  const renameFolder = async (id: string) => {
    if (busy) return
    const name = renameValue.trim()
    if (!name) {
      setRenamingId(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        setError('Failed to rename folder.')
        return
      }
      setRenamingId(null)
      await refreshFolders()
    } catch {
      setError('Failed to rename folder.')
    } finally {
      setBusy(false)
    }
  }

  const deleteFolder = async (id: string, folderName: string) => {
    if (busy) return
    if (!window.confirm(`Delete folder "${folderName}"?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/folders/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body.error === 'folder not empty') {
          setError('Cannot delete a folder that contains documents or subfolders.')
        } else {
          setError('Failed to delete folder.')
        }
        return
      }
      await refreshFolders()
      if (activeFolderId === id) {
        router.push('/')
      }
    } catch {
      setError('Failed to delete folder.')
    } finally {
      setBusy(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }

  const focusContextMenuItem = useCallback(
    (index: number) => {
      if (!contextMenu) return
      const itemCount = 3
      const normalized = (index + itemCount) % itemCount
      contextMenuItemRefs.current[normalized]?.focus()
    },
    [contextMenu],
  )

  useEffect(() => {
    if (!contextMenu) return
    const timer = setTimeout(() => focusContextMenuItem(0), 0)
    return () => clearTimeout(timer)
  }, [contextMenu, focusContextMenuItem])

  const handleContextMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!contextMenu) return
    const current = contextMenuItemRefs.current.findIndex((el) => el === document.activeElement)
    const active = current === -1 ? 0 : current

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusContextMenuItem(active + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusContextMenuItem(active - 1)
        break
      case 'Home':
        e.preventDefault()
        focusContextMenuItem(0)
        break
      case 'End':
        e.preventDefault()
        focusContextMenuItem(2)
        break
      case 'Escape':
        e.preventDefault()
        setContextMenu(null)
        break
    }
  }

  // Expose the drop target setter and docs setter for the layout DndContext
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ folderId: string | null }>).detail
      setDropTargetFolderId(detail?.folderId ?? null)
    }
    window.addEventListener('collabmd:dnd-drop-target', handler)
    return () => window.removeEventListener('collabmd:dnd-drop-target', handler)
  }, [])

  const renderFolder = (folder: Folder, depth: number) => {
    const children = getChildren(folder.id)
    const folderDocs = getDocsForFolder(folder.id)
    const hasChildren = children.length > 0
    const isExpanded = expanded.has(folder.id)
    const isActive = activeFolderId === folder.id

    const childSortableIds = [
      ...children.map((c) => `folder:${c.id}`),
      ...folderDocs.map((d) => `doc:${d.id}`),
    ]

    return (
      <div key={folder.id}>
        <SortableFolderRow
          folder={folder}
          depth={depth}
          isActive={isActive}
          isExpanded={isExpanded}
          hasChildren={hasChildren}
          renamingId={renamingId}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onToggleExpand={toggleExpand}
          onNavigate={navigateToFolder}
          onRename={renameFolder}
          onContextMenu={handleContextMenu}
          setRenamingId={setRenamingId}
          isConnected={connectedFolderIds.has(folder.id)}
          isDropTarget={dropTargetFolderId === folder.id}
        />

        {isExpanded && (
          <SortableContext items={childSortableIds} strategy={verticalListSortingStrategy}>
            {children.map((child) => renderFolder(child, depth + 1))}
            {folderDocs.map((doc) => (
              <SortableDocRow
                key={doc.id}
                doc={doc}
                depth={depth + 1}
                isActive={activeDocId === doc.id}
                onClose={() => setOpen(false)}
              />
            ))}
            {creating === folder.id && renderCreateInput(folder.id, depth + 1)}
          </SortableContext>
        )}
      </div>
    )
  }

  const renderCreateInput = (parentId: string | null, depth: number) => (
    <div className="flex items-center" style={{ paddingLeft: `${depth * 12 + 8 + 20}px` }}>
      <svg
        className="mr-1.5 h-4 w-4 shrink-0 text-fg-faint"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
        />
      </svg>
      <input
        ref={createInputRef}
        autoFocus
        placeholder="Folder name"
        className="min-w-0 flex-1 rounded border border-border-strong px-1 py-0.5 font-mono text-[13px]"
        value={createValue}
        onChange={(e) => setCreateValue(e.target.value)}
        onBlur={() => void createFolder(parentId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void createFolder(parentId)
          if (e.key === 'Escape') setCreating(null)
        }}
      />
    </div>
  )

  // Build sortable IDs for root level
  const rootSortableIds = [
    ...sortedRootFolders.map((f) => `folder:${f.id}`),
    ...rootDocs.map((d) => `doc:${d.id}`),
  ]

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between px-[10px] py-[12px]">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          Folders
        </span>
        <button
          onClick={() => {
            setCreating('root')
            setCreateValue('')
          }}
          disabled={busy}
          className="text-fg-faint opacity-40 hover:text-fg-muted hover:opacity-100"
          title="New folder"
        >
          <svg
            className="h-[14px] w-[14px]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      <SortableContext items={rootSortableIds} strategy={verticalListSortingStrategy}>
        {sortedRootFolders.map((folder) => renderFolder(folder, 0))}
        {creating === 'root' && renderCreateInput(null, 0)}
        {rootDocs.map((doc) => (
          <SortableDocRow
            key={doc.id}
            doc={doc}
            depth={0}
            isActive={activeDocId === doc.id}
            onClose={() => setOpen(false)}
          />
        ))}
      </SortableContext>

      {folders.length === 0 && rootDocs.length === 0 && creating === null && (
        <p className="px-[10px] py-1 text-xs text-fg-faint">No folders or documents yet</p>
      )}
      {error && <p className="px-[10px] py-1 text-xs text-red">{error}</p>}

      {/* Synced folders section */}
      {connectedFolders.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <span className="block px-[10px] py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">
            Synced folders
          </span>
          {connectedFolders.map((cf) => (
            <div
              key={cf.folderId ?? cf.folderName}
              className="flex items-center gap-1.5 px-[10px] py-1 text-[12px] text-fg-secondary"
              title={`${statusLabel(cf.status)} · ${cf.fileCount} files · ${formatRelativeTime(cf.lastSync)}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(cf.status)}`}
              />
              <span className="truncate">{cf.folderName}</span>
              <span className="ml-auto shrink-0 text-fg-faint">
                {formatRelativeTime(cf.lastSync)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 w-36 rounded border border-border bg-bg py-1 shadow"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            aria-label="folder actions"
            onKeyDown={handleContextMenuKeyDown}
          >
            <button
              ref={(el) => {
                contextMenuItemRefs.current[0] = el
              }}
              onClick={() => {
                const folder = folders.find((f) => f.id === contextMenu.id)
                if (folder) {
                  setRenamingId(folder.id)
                  setRenameValue(folder.name)
                }
                setContextMenu(null)
              }}
              className="flex w-full px-3 py-1.5 text-left font-sans text-[13px] text-fg-secondary hover:bg-bg-hover"
              disabled={busy}
              role="menuitem"
              tabIndex={-1}
            >
              Rename
            </button>
            <button
              ref={(el) => {
                contextMenuItemRefs.current[1] = el
              }}
              onClick={() => {
                setCreating(contextMenu.id)
                setCreateValue('')
                setExpanded((prev) => new Set([...prev, contextMenu.id]))
                setContextMenu(null)
              }}
              className="flex w-full px-3 py-1.5 text-left font-sans text-[13px] text-fg-secondary hover:bg-bg-hover"
              disabled={busy}
              role="menuitem"
              tabIndex={-1}
            >
              New subfolder
            </button>
            <button
              ref={(el) => {
                contextMenuItemRefs.current[2] = el
              }}
              onClick={() => {
                const folder = folders.find((f) => f.id === contextMenu.id)
                if (folder) {
                  void deleteFolder(contextMenu.id, folder.name)
                }
                setContextMenu(null)
              }}
              disabled={busy}
              className="flex w-full px-3 py-1.5 text-left font-sans text-[13px] text-red hover:bg-bg-hover disabled:opacity-50"
              role="menuitem"
              tabIndex={-1}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
