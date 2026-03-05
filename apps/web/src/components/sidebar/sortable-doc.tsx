'use client'

import Link from 'next/link'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface SortableDocRowProps {
  doc: { id: string; title: string; folderId: string | null }
  depth: number
  isActive: boolean
  onClose: () => void
}

export function SortableDocRow({ doc, depth, isActive, onClose }: SortableDocRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `doc:${doc.id}`,
    data: { type: 'document', doc, title: doc.title },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${depth * 12 + 8 + 20}px`,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Link
        href={`/doc/${doc.id}`}
        onClick={onClose}
        className={`group flex items-center rounded pr-1 text-[13px] ${
          isActive ? 'bg-bg text-fg shadow-sm' : 'text-fg-secondary hover:bg-bg-hover hover:text-fg'
        }`}
        title={doc.title}
      >
        <span
          {...listeners}
          className="mr-1 shrink-0 cursor-grab text-fg-faint opacity-0 transition-opacity group-hover:opacity-40 active:cursor-grabbing"
          onClick={(e) => e.preventDefault()}
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </span>
        <span
          className={`mr-1.5 shrink-0 font-mono text-[11px] ${isActive ? 'text-fg-muted' : 'text-fg-faint'}`}
        >
          #
        </span>
        <span className="min-w-0 flex-1 truncate py-[5px]">{doc.title}</span>
      </Link>
    </div>
  )
}
