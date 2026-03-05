'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { registerShortcut, handleGlobalKeyDown, type ShortcutDef } from '@/lib/keyboard-shortcuts'

interface KeyboardShortcutState {
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
  shortcutHelpOpen: boolean
  setShortcutHelpOpen: (open: boolean) => void
}

const KeyboardShortcutContext = createContext<KeyboardShortcutState | null>(null)

export function useKeyboardShortcuts() {
  const ctx = useContext(KeyboardShortcutContext)
  if (!ctx) throw new Error('useKeyboardShortcuts must be used within KeyboardShortcutProvider')
  return ctx
}

interface KeyboardShortcutProviderProps {
  children: React.ReactNode
  onToggleSidebar?: () => void
  onFocusEditor?: () => void
  onForceSnapshot?: () => void
  onOpenHistory?: () => void
  onShareDocument?: () => void
  onAddComment?: () => void
}

export function KeyboardShortcutProvider({
  children,
  onToggleSidebar,
  onFocusEditor,
  onForceSnapshot,
  onOpenHistory,
  onShareDocument,
  onAddComment,
}: KeyboardShortcutProviderProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)

  // Keep refs to callbacks to avoid re-registering shortcuts
  const onToggleSidebarRef = useRef(onToggleSidebar)
  const onFocusEditorRef = useRef(onFocusEditor)
  const onForceSnapshotRef = useRef(onForceSnapshot)
  const onOpenHistoryRef = useRef(onOpenHistory)
  const onShareDocumentRef = useRef(onShareDocument)
  const onAddCommentRef = useRef(onAddComment)

  useEffect(() => {
    onToggleSidebarRef.current = onToggleSidebar
  }, [onToggleSidebar])
  useEffect(() => {
    onFocusEditorRef.current = onFocusEditor
  }, [onFocusEditor])
  useEffect(() => {
    onForceSnapshotRef.current = onForceSnapshot
  }, [onForceSnapshot])
  useEffect(() => {
    onOpenHistoryRef.current = onOpenHistory
  }, [onOpenHistory])
  useEffect(() => {
    onShareDocumentRef.current = onShareDocument
  }, [onShareDocument])
  useEffect(() => {
    onAddCommentRef.current = onAddComment
  }, [onAddComment])

  const setCommandPaletteOpenRef = useRef(setCommandPaletteOpen)
  setCommandPaletteOpenRef.current = setCommandPaletteOpen

  const setShortcutHelpOpenRef = useRef(setShortcutHelpOpen)
  setShortcutHelpOpenRef.current = setShortcutHelpOpen

  useEffect(() => {
    const shortcuts: ShortcutDef[] = [
      {
        id: 'command-palette',
        label: 'Command palette',
        category: 'navigation',
        keys: 'Mod-k',
        action: () => {
          setCommandPaletteOpenRef.current((prev) => !prev)
          return true
        },
      },
      {
        id: 'search-documents',
        label: 'Search documents',
        category: 'navigation',
        keys: 'Mod-p',
        action: () => {
          setCommandPaletteOpenRef.current(true)
          return true
        },
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        category: 'navigation',
        keys: 'Mod-\\',
        action: () => {
          onToggleSidebarRef.current?.()
          return true
        },
      },
      {
        id: 'focus-editor',
        label: 'Focus editor',
        category: 'editor',
        keys: 'Mod-Shift-e',
        action: () => {
          onFocusEditorRef.current?.()
          return true
        },
      },
      {
        id: 'force-snapshot',
        label: 'Save snapshot',
        category: 'document',
        keys: 'Mod-s',
        action: () => {
          onForceSnapshotRef.current?.()
          return true
        },
      },
      {
        id: 'open-history',
        label: 'Version history',
        category: 'document',
        keys: 'Mod-Shift-h',
        action: () => {
          onOpenHistoryRef.current?.()
          return true
        },
      },
      {
        id: 'share-document',
        label: 'Share document',
        category: 'collaboration',
        keys: 'Mod-Shift-s',
        action: () => {
          onShareDocumentRef.current?.()
          return true
        },
      },
      {
        id: 'add-comment',
        label: 'Add comment',
        category: 'collaboration',
        keys: 'Mod-Shift-m',
        action: () => {
          onAddCommentRef.current?.()
          return true
        },
      },
      {
        id: 'shortcut-help',
        label: 'Keyboard shortcuts',
        category: 'navigation',
        keys: 'Mod-/',
        action: () => {
          setShortcutHelpOpenRef.current((prev) => !prev)
          return true
        },
      },
    ]

    const unregisters = shortcuts.map(registerShortcut)

    const onKeyDown = (event: KeyboardEvent) => handleGlobalKeyDown(event)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unregisters.forEach((unregister) => unregister())
    }
  }, [])

  return (
    <KeyboardShortcutContext.Provider
      value={{
        commandPaletteOpen,
        setCommandPaletteOpen,
        shortcutHelpOpen,
        setShortcutHelpOpen,
      }}
    >
      {children}
    </KeyboardShortcutContext.Provider>
  )
}
