'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Folder } from './sidebar-context'

interface SortableFolderRowProps {
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
  isDropTarget: boolean
  connectedTooltip?: string
}

export function SortableFolderRow({
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
  isDropTarget,
  connectedTooltip,
}: SortableFolderRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `folder:${folder.id}`,
    data: { type: 'folder', folder, title: folder.name },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${depth * 12 + 8}px`,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      title={connectedTooltip}
      className={`group flex items-center rounded pr-1 text-[13px] ${
        isDropTarget
          ? 'bg-accent-subtle ring-2 ring-accent'
          : isActive
            ? 'bg-bg text-fg shadow-sm'
            : 'text-fg-secondary hover:bg-bg-hover hover:text-fg'
      }`}
      onContextMenu={(e) => onContextMenu(e, folder.id)}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={() => hasChildren && onToggleExpand(folder.id)}
        className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
        aria-label={
          hasChildren ? (isExpanded ? 'collapse folder' : 'expand folder') : 'drag folder'
        }
        aria-expanded={hasChildren ? isExpanded : undefined}
      >
        {hasChildren ? (
          <span
            className={`text-[9px] text-fg-faint opacity-40 transition-transform ${isExpanded ? 'inline-block rotate-90' : ''}`}
          >
            &#9654;
          </span>
        ) : (
          <span className="text-[9px] text-fg-faint opacity-20">&#9776;</span>
        )}
      </button>
      <span className="relative mr-1.5 shrink-0">
        <svg
          className="h-4 w-4 text-fg-faint"
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
        {isConnected && (
          <span
            className="absolute -bottom-[1px] -right-[1px] h-[5px] w-[5px] rounded-full bg-green"
            title="Synced from local"
          />
        )}
      </span>
      {renamingId === folder.id ? (
        <input
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
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
          />
        </svg>
      </button>
    </div>
  )
}
