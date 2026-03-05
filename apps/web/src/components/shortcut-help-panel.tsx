'use client'

import { useEffect, useRef } from 'react'
import { formatKeyCombo } from '@/lib/keyboard-shortcuts'

interface ShortcutEntry {
  label: string
  keys: string
}

const editorShortcuts: ShortcutEntry[] = [
  { label: 'Bold', keys: 'Mod-b' },
  { label: 'Italic', keys: 'Mod-i' },
  { label: 'Inline code', keys: 'Mod-e' },
  { label: 'Strikethrough', keys: 'Mod-Shift-x' },
  { label: 'Link', keys: 'Mod-Shift-k' },
  { label: 'Heading 1', keys: 'Mod-1' },
  { label: 'Heading 2', keys: 'Mod-2' },
  { label: 'Heading 3', keys: 'Mod-3' },
  { label: 'Numbered list', keys: 'Mod-Shift-7' },
  { label: 'Bullet list', keys: 'Mod-Shift-8' },
  { label: 'Checkbox list', keys: 'Mod-Shift-9' },
  { label: 'Blockquote', keys: 'Mod-Shift-.' },
  { label: 'Code block', keys: 'Mod-Alt-c' },
  { label: 'Focus editor', keys: 'Mod-Shift-e' },
]

const navigationShortcuts: ShortcutEntry[] = [
  { label: 'Command palette', keys: 'Mod-k' },
  { label: 'Search documents', keys: 'Mod-p' },
  { label: 'Toggle sidebar', keys: 'Mod-\\' },
  { label: 'Keyboard shortcuts', keys: 'Mod-/' },
]

const documentShortcuts: ShortcutEntry[] = [
  { label: 'Save snapshot', keys: 'Mod-s' },
  { label: 'Version history', keys: 'Mod-Shift-h' },
]

const collaborationShortcuts: ShortcutEntry[] = [
  { label: 'Share document', keys: 'Mod-Shift-s' },
  { label: 'Add comment', keys: 'Mod-Shift-m' },
]

interface ShortcutHelpPanelProps {
  open: boolean
  onClose: () => void
}

function ShortcutGroup({ title, shortcuts }: { title: string; shortcuts: ShortcutEntry[] }) {
  return (
    <div>
      <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {title}
      </h3>
      <div className="space-y-1">
        {shortcuts.map((entry) => (
          <div key={entry.keys} className="flex items-center justify-between py-1">
            <span className="text-sm text-fg-secondary">{entry.label}</span>
            <kbd className="rounded border border-border bg-bg-subtle px-2 py-0.5 font-mono text-[11px] text-fg-muted">
              {formatKeyCombo(entry.keys)}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ShortcutHelpPanel({ open, onClose }: ShortcutHelpPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const previousActive = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousActive?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        className="relative z-10 w-full max-w-[600px] rounded-lg border border-border bg-bg p-6 shadow-lg outline-none"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-sans text-lg font-semibold text-fg">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-muted hover:text-fg"
            aria-label="close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <ShortcutGroup title="Editor" shortcuts={editorShortcuts} />
          <ShortcutGroup title="Navigation" shortcuts={navigationShortcuts} />
          <ShortcutGroup title="Document" shortcuts={documentShortcuts} />
          <ShortcutGroup title="Collaboration" shortcuts={collaborationShortcuts} />
        </div>
      </div>
    </div>
  )
}
