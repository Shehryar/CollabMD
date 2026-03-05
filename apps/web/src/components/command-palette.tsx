'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  formatKeyCombo,
  getRegisteredShortcuts,
  filterCommandItems,
  type CommandItem,
} from '@/lib/keyboard-shortcuts'

interface Document {
  id: string
  title: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  documents: Document[]
  onToggleSidebar?: () => void
  onOpenHistory?: () => void
  onShareDocument?: () => void
  onOpenShortcutHelp?: () => void
}

export default function CommandPalette({
  open,
  onClose,
  documents,
  onToggleSidebar,
  onOpenHistory,
  onShareDocument,
  onOpenShortcutHelp,
}: CommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const allItems = useMemo((): CommandItem[] => {
    const docItems: CommandItem[] = documents.map((doc) => ({
      id: `doc-${doc.id}`,
      label: doc.title || 'Untitled',
      category: 'documents',
      action: () => {
        router.push(`/doc/${doc.id}`)
        onClose()
      },
    }))

    const shortcuts = getRegisteredShortcuts()
    const actionItems: CommandItem[] = [
      {
        id: 'action-new-document',
        label: 'New document',
        category: 'actions',
        action: () => {
          // Trigger the same event the sidebar uses
          const createButton = document
            .querySelector('[aria-label="close sidebar"]')
            ?.parentElement?.querySelector('button')
          if (createButton) createButton.click()
          onClose()
        },
      },
      {
        id: 'action-toggle-sidebar',
        label: 'Toggle sidebar',
        category: 'actions',
        shortcut: formatKeyCombo('Mod-\\'),
        action: () => {
          onToggleSidebar?.()
          onClose()
        },
      },
      {
        id: 'action-version-history',
        label: 'Version history',
        category: 'actions',
        shortcut: formatKeyCombo('Mod-Shift-h'),
        action: () => {
          onOpenHistory?.()
          onClose()
        },
      },
      {
        id: 'action-share',
        label: 'Share document',
        category: 'actions',
        shortcut: formatKeyCombo('Mod-Shift-s'),
        action: () => {
          onShareDocument?.()
          onClose()
        },
      },
      {
        id: 'action-keyboard-shortcuts',
        label: 'Keyboard shortcuts',
        category: 'actions',
        shortcut: formatKeyCombo('Mod-/'),
        action: () => {
          onOpenShortcutHelp?.()
          onClose()
        },
      },
    ]

    // Add registered shortcut actions that aren't already covered
    const coveredIds = new Set([
      'command-palette',
      'search-documents',
      'toggle-sidebar',
      'open-history',
      'share-document',
      'shortcut-help',
      'add-comment',
      'focus-editor',
      'force-snapshot',
    ])
    for (const sc of shortcuts) {
      if (coveredIds.has(sc.id)) continue
      actionItems.push({
        id: `action-${sc.id}`,
        label: sc.label,
        category: 'actions',
        shortcut: formatKeyCombo(sc.keys),
        action: () => {
          sc.action()
          onClose()
        },
      })
    }

    return [...docItems, ...actionItems]
  }, [
    documents,
    router,
    onClose,
    onToggleSidebar,
    onOpenHistory,
    onShareDocument,
    onOpenShortcutHelp,
  ])

  const filtered = useMemo(() => filterCommandItems(allItems, query), [allItems, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // Focus input after render
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((prev) => (prev + 1) % Math.max(filtered.length, 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = filtered[activeIndex]
        if (item) item.action()
        return
      }
    },
    [filtered, activeIndex, onClose],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Trap focus + close on outside click
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const docResults = filtered.filter((item) => item.category === 'documents')
  const actionResults = filtered.filter((item) => item.category === 'actions')

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div
        ref={modalRef}
        role="dialog"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-[520px] rounded-lg border border-border bg-bg shadow-lg"
      >
        <div className="border-b border-border px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search documents and actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent font-sans text-sm text-fg placeholder:text-fg-muted outline-none"
            aria-label="Search commands"
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls="command-palette-list"
            aria-activedescendant={
              filtered[activeIndex] ? `cp-item-${filtered[activeIndex].id}` : undefined
            }
          />
        </div>
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-[320px] overflow-y-auto p-1"
        >
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-fg-muted">No results found</div>
          )}

          {docResults.length > 0 && (
            <>
              <div className="px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                Documents
              </div>
              {docResults.map((item) => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <button
                    key={item.id}
                    id={`cp-item-${item.id}`}
                    role="option"
                    aria-selected={globalIdx === activeIndex}
                    type="button"
                    onClick={() => item.action()}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                    className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm ${
                      globalIdx === activeIndex
                        ? 'bg-accent-subtle text-fg'
                        : 'text-fg-secondary hover:bg-bg-subtle'
                    }`}
                  >
                    <svg
                      className="h-4 w-4 shrink-0 opacity-50"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                )
              })}
            </>
          )}

          {actionResults.length > 0 && (
            <>
              {docResults.length > 0 && <div className="my-1 border-t border-border" />}
              <div className="px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                Actions
              </div>
              {actionResults.map((item) => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <button
                    key={item.id}
                    id={`cp-item-${item.id}`}
                    role="option"
                    aria-selected={globalIdx === activeIndex}
                    type="button"
                    onClick={() => item.action()}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                    className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm ${
                      globalIdx === activeIndex
                        ? 'bg-accent-subtle text-fg'
                        : 'text-fg-secondary hover:bg-bg-subtle'
                    }`}
                  >
                    <svg
                      className="h-4 w-4 shrink-0 opacity-50"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                      />
                    </svg>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.shortcut && (
                      <kbd className="ml-auto shrink-0 rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>
        <div className="border-t border-border px-3 py-2 flex items-center gap-3 text-[10px] font-mono text-fg-muted">
          <span>
            <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5">
              &#8593;&#8595;
            </kbd>{' '}
            navigate
          </span>
          <span>
            <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5">&#9166;</kbd>{' '}
            select
          </span>
          <span>
            <kbd className="rounded border border-border bg-bg-subtle px-1 py-0.5">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
