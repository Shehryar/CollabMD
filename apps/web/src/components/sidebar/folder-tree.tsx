'use client'

import { useCallback, useRef, useState } from 'react'
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
}) {
  const { isOver, setNodeRef } = useDroppable({ id: folder.id })
  const renameInputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center rounded-md pr-1 text-sm ${
        isOver
          ? 'bg-blue-50 ring-2 ring-blue-300'
          : isActive
          ? 'bg-gray-100 font-medium text-gray-900'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onContextMenu={(e) => onContextMenu(e, folder.id)}
    >
      <button
        onClick={() => hasChildren && onToggleExpand(folder.id)}
        className="flex h-6 w-5 shrink-0 items-center justify-center"
      >
        {hasChildren && (
          <svg
            className={`h-3 w-3 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>
      <svg className="mr-1.5 h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
      {renamingId === folder.id ? (
        <input
          ref={renameInputRef}
          autoFocus
          className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 text-sm"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => onRename(folder.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(folder.id)
            if (e.key === 'Escape') setRenamingId(null)
          }}
        />
      ) : (
        <button
          onClick={() => onNavigate(folder.id)}
          className="min-w-0 flex-1 truncate py-1.5 text-left"
        >
          {folder.name}
        </button>
      )}
      <button
        onClick={(e) => onContextMenu(e, folder.id)}
        className="ml-auto hidden shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 group-hover:block"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
        </svg>
      </button>
    </div>
  )
}

export function FolderTree() {
  const { folders, refreshFolders, setOpen } = useSidebar()
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
  const createInputRef = useRef<HTMLInputElement>(null)

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

  const getChildren = useCallback(
    (parentId: string) => folders.filter((f) => f.parentId === parentId),
    [folders],
  )

  const createFolder = async (parentId: string | null) => {
    const name = createValue.trim()
    if (!name || !activeOrg?.id) {
      setCreating(null)
      return
    }
    await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, orgId: activeOrg.id, parentId }),
    })
    setCreateValue('')
    setCreating(null)
    await refreshFolders()
  }

  const renameFolder = async (id: string) => {
    const name = renameValue.trim()
    if (!name) {
      setRenamingId(null)
      return
    }
    await fetch(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setRenamingId(null)
    await refreshFolders()
  }

  const deleteFolder = async (id: string) => {
    const res = await fetch(`/api/folders/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json()
      if (body.error === 'folder_not_empty') {
        alert('Cannot delete a folder that contains documents or subfolders.')
      }
      return
    }
    await refreshFolders()
    if (activeFolderId === id) {
      router.push('/')
    }
  }

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
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
      <svg className="mr-1.5 h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
      <input
        ref={createInputRef}
        autoFocus
        placeholder="Folder name"
        className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 text-sm"
        value={createValue}
        onChange={(e) => setCreateValue(e.target.value)}
        onBlur={() => createFolder(parentId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') createFolder(parentId)
          if (e.key === 'Escape') setCreating(null)
        }}
      />
    </div>
  )

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Folders</span>
        <button
          onClick={() => {
            setCreating('root')
            setCreateValue('')
          }}
          className="rounded p-0.5 text-gray-400 hover:text-gray-600"
          title="New folder"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {rootFolders.map((folder) => renderFolder(folder, 0))}
      {creating === 'root' && renderCreateInput(null, 0)}

      {folders.length === 0 && creating === null && (
        <p className="px-2 py-1 text-xs text-gray-400">No folders yet</p>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                const folder = folders.find((f) => f.id === contextMenu.id)
                if (folder) {
                  setRenamingId(folder.id)
                  setRenameValue(folder.name)
                }
                setContextMenu(null)
              }}
              className="flex w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              Rename
            </button>
            <button
              onClick={() => {
                setCreating(contextMenu.id)
                setCreateValue('')
                setExpanded((prev) => new Set([...prev, contextMenu.id]))
                setContextMenu(null)
              }}
              className="flex w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              New subfolder
            </button>
            <button
              onClick={() => {
                deleteFolder(contextMenu.id)
                setContextMenu(null)
              }}
              className="flex w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-gray-50"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
