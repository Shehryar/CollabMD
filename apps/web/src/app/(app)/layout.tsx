'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { SidebarProvider, useSidebar } from '@/components/sidebar/sidebar-context'
import { Sidebar } from '@/components/sidebar/sidebar'
import { WebMcpProvider } from '@/components/dev/webmcp-provider'
import { ToastProvider, useToast } from '@/components/toast'
import {
  KeyboardShortcutProvider,
  useKeyboardShortcuts,
} from '@/components/keyboard-shortcut-provider'
import CommandPalette from '@/components/command-palette'
import ShortcutHelpPanel from '@/components/shortcut-help-panel'
import { wouldCreateCircle } from '@/components/sidebar/folder-tree-utils'

function MobileMenuButton() {
  const { setOpen } = useSidebar()
  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed left-3 top-3 z-30 rounded border border-border bg-bg p-1.5 shadow-sm lg:hidden"
    >
      <svg
        className="h-5 w-5 text-fg-secondary"
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
    </button>
  )
}

/** Parse a sortable ID like "folder:abc" or "doc:xyz" into type + raw ID. */
function parseSortableId(sortableId: string): { type: 'folder' | 'document'; id: string } | null {
  if (sortableId.startsWith('folder:')) return { type: 'folder', id: sortableId.slice(7) }
  if (sortableId.startsWith('doc:')) return { type: 'document', id: sortableId.slice(4) }
  return null
}

interface SidebarDoc {
  id: string
  title: string
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { folders, refreshFolders, open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar()
  const { commandPaletteOpen, setCommandPaletteOpen, shortcutHelpOpen, setShortcutHelpOpen } =
    useKeyboardShortcuts()
  const { toast } = useToast()
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null)
  const [documents, setDocuments] = useState<SidebarDoc[]>([])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const refreshingRef = useRef(false)

  // Fetch documents for command palette
  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/documents', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as unknown
        if (!Array.isArray(body)) return
        setDocuments(
          body
            .filter(
              (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
            )
            .map((item) => ({
              id: typeof item.id === 'string' ? item.id : '',
              title: typeof item.title === 'string' && item.title.trim() ? item.title : 'Untitled',
            }))
            .filter((doc) => doc.id.length > 0),
        )
      } catch {
        // Keep existing state
      }
    }

    void fetchDocs()

    const onDocsChanged = () => {
      void fetchDocs()
    }
    window.addEventListener('collabmd:documents-changed', onDocsChanged)
    return () => window.removeEventListener('collabmd:documents-changed', onDocsChanged)
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    setDraggingLabel((data?.title as string) ?? (data?.type === 'folder' ? 'Folder' : 'Document'))
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | undefined
    if (!overId) {
      window.dispatchEvent(
        new CustomEvent('collabmd:dnd-drop-target', { detail: { folderId: null } }),
      )
      return
    }
    const parsed = parseSortableId(overId)
    if (parsed?.type === 'folder') {
      window.dispatchEvent(
        new CustomEvent('collabmd:dnd-drop-target', { detail: { folderId: parsed.id } }),
      )
    } else {
      window.dispatchEvent(
        new CustomEvent('collabmd:dnd-drop-target', { detail: { folderId: null } }),
      )
    }
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setDraggingLabel(null)
      window.dispatchEvent(
        new CustomEvent('collabmd:dnd-drop-target', { detail: { folderId: null } }),
      )

      const { active, over } = event
      if (!over || active.id === over.id) return

      const activeId = active.id as string
      const overId = over.id as string

      const activeParsed = parseSortableId(activeId)
      const overParsed = parseSortableId(overId)

      if (!activeParsed) {
        // Legacy: plain doc ID being dragged to a folder droppable (old behavior)
        const docId = activeId
        const folderId = overId
        try {
          const res = await fetch(`/api/documents/${docId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId }),
          })
          if (!res.ok) return
          await refreshFolders()
          window.dispatchEvent(new Event('collabmd:documents-changed'))
        } catch {
          // No-op
        }
        return
      }

      if (!overParsed) return

      // Folder reordering: reorder within same parent level
      if (activeParsed.type === 'folder' && overParsed.type === 'folder') {
        const activeFolder = folders.find((f) => f.id === activeParsed.id)
        const overFolder = folders.find((f) => f.id === overParsed.id)
        if (!activeFolder || !overFolder) return

        if (activeFolder.parentId !== overFolder.parentId) {
          const newParentId = overFolder.parentId
          if (wouldCreateCircle(activeParsed.id, newParentId, folders)) {
            toast('Cannot move folder into its own descendant', 'error')
            return
          }
          try {
            const res = await fetch(`/api/folders/${activeParsed.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ parentId: newParentId, position: overFolder.position }),
            })
            if (!res.ok) {
              const body = await res.json().catch(() => ({}))
              toast(body.error ?? 'Failed to move folder', 'error')
              return
            }
            await refreshFolders()
          } catch {
            toast('Failed to move folder', 'error')
          }
          return
        }

        // Same parent: reorder siblings
        const siblings = folders
          .filter((f) => f.parentId === activeFolder.parentId)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))

        const activeIndex = siblings.findIndex((f) => f.id === activeParsed.id)
        const overIndex = siblings.findIndex((f) => f.id === overParsed.id)
        if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return

        const reordered = [...siblings]
        const [moved] = reordered.splice(activeIndex, 1)
        reordered.splice(overIndex, 0, moved)

        const updates: Array<{ id: string; position: number }> = []
        for (let i = 0; i < reordered.length; i++) {
          if (reordered[i].position !== i) {
            updates.push({ id: reordered[i].id, position: i })
          }
        }

        if (updates.length > 0 && !refreshingRef.current) {
          refreshingRef.current = true
          try {
            await Promise.all(
              updates.map((u) =>
                fetch(`/api/folders/${u.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ position: u.position }),
                }),
              ),
            )
            await refreshFolders()
          } catch {
            toast('Failed to reorder folders', 'error')
            await refreshFolders()
          } finally {
            refreshingRef.current = false
          }
        }
        return
      }

      // Document reordering within same folder
      if (activeParsed.type === 'document' && overParsed.type === 'document') {
        const activeData = active.data.current?.doc as
          | { id: string; folderId: string | null }
          | undefined
        const overData = over.data.current?.doc as
          | { id: string; folderId: string | null }
          | undefined
        if (!activeData || !overData) return
        if (activeData.folderId !== overData.folderId) return

        const overPosition = (over.data.current?.doc as { position?: number })?.position ?? 0
        try {
          const res = await fetch(`/api/documents/${activeParsed.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position: overPosition }),
          })
          if (!res.ok) {
            toast('Failed to reorder document', 'error')
            return
          }
          window.dispatchEvent(new Event('collabmd:documents-changed'))
        } catch {
          toast('Failed to reorder document', 'error')
        }
        return
      }

      // Moving doc onto a folder
      if (activeParsed.type === 'document' && overParsed.type === 'folder') {
        try {
          const res = await fetch(`/api/documents/${activeParsed.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId: overParsed.id }),
          })
          if (!res.ok) {
            toast('Failed to move document', 'error')
            return
          }
          await refreshFolders()
          window.dispatchEvent(new Event('collabmd:documents-changed'))
        } catch {
          toast('Failed to move document', 'error')
        }
        return
      }

      // Moving folder onto a doc's folder
      if (activeParsed.type === 'folder' && overParsed.type === 'document') {
        const overDoc = over.data.current?.doc as { folderId: string | null } | undefined
        const targetFolderId = overDoc?.folderId ?? null
        if (wouldCreateCircle(activeParsed.id, targetFolderId, folders)) {
          toast('Cannot move folder into its own descendant', 'error')
          return
        }
        const activeFolder = folders.find((f) => f.id === activeParsed.id)
        if (activeFolder && activeFolder.parentId === targetFolderId) return
        try {
          const res = await fetch(`/api/folders/${activeParsed.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentId: targetFolderId }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            toast(body.error ?? 'Failed to move folder', 'error')
            return
          }
          await refreshFolders()
        } catch {
          toast('Failed to move folder', 'error')
        }
      }
    },
    [folders, refreshFolders, toast],
  )

  const toggleSidebar = useCallback(
    () => setSidebarOpen(!sidebarOpen),
    [sidebarOpen, setSidebarOpen],
  )

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <MobileMenuButton />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      <DragOverlay>
        {draggingLabel && (
          <div className="rounded border border-accent bg-bg-subtle px-3 py-2 text-sm font-medium text-fg shadow-lg opacity-90">
            {draggingLabel}
          </div>
        )}
      </DragOverlay>
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        documents={documents}
        onToggleSidebar={toggleSidebar}
        onOpenShortcutHelp={() => setShortcutHelpOpen(true)}
      />
      <ShortcutHelpPanel open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </DndContext>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar()
  const toggleSidebar = useCallback(
    () => setSidebarOpen(!sidebarOpen),
    [sidebarOpen, setSidebarOpen],
  )

  return (
    <KeyboardShortcutProvider onToggleSidebar={toggleSidebar}>
      <AppShellInner>{children}</AppShellInner>
    </KeyboardShortcutProvider>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-fg-muted">
          Loading...
        </div>
      }
    >
      <SidebarProvider>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </SidebarProvider>
      {process.env.NODE_ENV === 'development' && <WebMcpProvider />}
    </Suspense>
  )
}
