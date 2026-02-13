'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDroppable } from '@dnd-kit/core'
import { useActiveOrganization } from '@/lib/auth-client'
import { useSidebar, type Folder } from './sidebar-context'

function DroppableFolderRow({
  folder,
  depth,
  isActive,
  isExpanded,
  hasChildren,
  renamingId,
  renameValue,
  setRenameValue,
  onToggleExpand,
  onNavigate,
  onRename,
  onContextMenu,
  setRenamingId,
  isConnected,
}: {
  folder: Folder
  depth: number
  isActive: boolean
  isExpanded: boolean
  hasChildren: boolean
  renamingId: string | null
  renameValue: string
  setRenameValue: (v: string) => void
  onToggleExpand: (id: string) => void
  onNavigate: (id: string) => void
  onRename: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  setRenamingId: (id: string | null) => void
  isConnected: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({ id: folder.id })
  const renameInputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center rounded pr-1 text-[13px] ${
        isOver
          ? 'bg-accent-subtle ring-2 ring-accent'
          : isActive
          ? 'bg-bg text-fg shadow-sm'
          : 'text-fg-secondary hover:bg-bg-hover hover:text-fg'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onContextMenu={(e) => onContextMenu(e, folder.id)}
    >
      <button
        onClick={() => hasChildren && onToggleExpand(folder.id)}
        className="flex h-6 w-5 shrink-0 items-center justify-center"
        aria-label={hasChildren ? (isExpanded ? 'collapse folder' : 'expand folder') : 'folder'}
        aria-expanded={hasChildren ? isExpanded : undefined}
      >
        {hasChildren && (
          <span className={`text-[9px] text-fg-faint opacity-40 transition-transform ${isExpanded ? 'inline-block rotate-90' : ''}`}>
            &#9654;
          </span>
        )}
      </button>
      <span className="relative mr-1.5 shrink-0">
        <svg className="h-4 w-4 text-fg-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        {isConnected && (
          <span className="absolute -bottom-[1px] -right-[1px] h-[5px] w-[5px] rounded-full bg-green" title="Synced from local" />
        )}
      </span>
      {renamingId === folder.id ? (
        <input
          ref={renameInputRef}
          autoFocus
          className="min-w-0 flex-1 rounded border border-border-strong px-1 py-0.5 font-mono text-[13px]"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => void onRename(folder.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onRename(folder.id)
            if (e.key === 'Escape') setRenamingId(null)
          }}
        />
      ) : (
        <button
          onClick={() => onNavigate(folder.id)}
          className="min-w-0 flex-1 truncate py-[5px] text-left"
        >
          {folder.name}
        </button>
      )}
      <button
        onClick={(e) => onContextMenu(e, folder.id)}
        className="ml-auto hidden shrink-0 rounded p-0.5 text-fg-faint hover:text-fg-muted group-hover:block"
        aria-haspopup="menu"
        aria-label="folder actions"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
        </svg>
      </button>
    </div>
  )
}

export function FolderTree() {
  const { folders, connectedFolders, refreshFolders, setOpen } = useSidebar()
  const { data: activeOrg } = useActiveOrganization()
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeFolderId = searchParams.get('folder')

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState<string | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const rootFolders = folders.filter((f) => !f.parentId)
  const connectedFolderIds = useMemo(() => {
    return new Set(
      connectedFolders
        .map((folder) => folder.folderId)
        .filter((id): id is string => id !== null),
    )
  }, [connectedFolders])

  const getChildren = useCallback(
    (parentId: string) => folders.filter((f) => f.parentId === parentId),
    [folders],
  )

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

  const focusContextMenuItem = useCallback((index: number) => {
    if (!contextMenu) return
    const itemCount = 3
    const normalized = (index + itemCount) % itemCount
    contextMenuItemRefs.current[normalized]?.focus()
  }, [contextMenu])

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

  const renderFolder = (folder: Folder, depth: number) => {
    const children = getChildren(folder.id)
    const hasChildren = children.length > 0
    const isExpanded = expanded.has(folder.id)
    const isActive = activeFolderId === folder.id

    return (
      <div key={folder.id}>
        <DroppableFolderRow
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
        />

        {isExpanded && (
          <>
            {children.map((child) => renderFolder(child, depth + 1))}
            {creating === folder.id && renderCreateInput(folder.id, depth + 1)}
          </>
        )}
      </div>
    )
  }

  const renderCreateInput = (parentId: string | null, depth: number) => (
    <div className="flex items-center" style={{ paddingLeft: `${depth * 12 + 8 + 20}px` }}>
      <svg className="mr-1.5 h-4 w-4 shrink-0 text-fg-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
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

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between px-[10px] py-[12px]">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Folders</span>
        <button
          onClick={() => {
            setCreating('root')
            setCreateValue('')
          }}
          disabled={busy}
          className="text-fg-faint opacity-40 hover:text-fg-muted hover:opacity-100"
          title="New folder"
        >
          <svg className="h-[14px] w-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {rootFolders.map((folder) => renderFolder(folder, 0))}
      {creating === 'root' && renderCreateInput(null, 0)}

      {folders.length === 0 && creating === null && (
        <p className="px-[10px] py-1 text-xs text-fg-faint">No folders yet</p>
      )}
      {error && <p className="px-[10px] py-1 text-xs text-red">{error}</p>}

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
