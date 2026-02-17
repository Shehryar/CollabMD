'use client'

import { Suspense, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useState } from 'react'
import { SidebarProvider, useSidebar } from '@/components/sidebar/sidebar-context'
import { Sidebar } from '@/components/sidebar/sidebar'
import { WebMcpProvider } from '@/components/dev/webmcp-provider'
import { ToastProvider } from '@/components/toast'

function MobileMenuButton() {
  const { setOpen } = useSidebar()
  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed left-3 top-3 z-30 rounded border border-border bg-bg p-1.5 shadow-sm lg:hidden"
    >
      <svg className="h-5 w-5 text-fg-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    </button>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { refreshFolders } = useSidebar()
  const [draggingTitle, setDraggingTitle] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingTitle((event.active.data.current?.title as string) ?? 'Document')
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setDraggingTitle(null)
    const { active, over } = event
    if (!over) return

    const docId = active.id as string
    const folderId = over.id as string

    // Move doc to folder via PATCH
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
      // No-op; move errors are handled by page-level refresh paths.
    }
  }, [refreshFolders])

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <MobileMenuButton />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      <DragOverlay>
        {draggingTitle && (
          <div className="rounded border border-border-strong bg-bg-subtle px-3 py-2 text-sm font-medium text-fg shadow">
            {draggingTitle}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-fg-muted">Loading...</div>}>
      <SidebarProvider>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </SidebarProvider>
      {process.env.NODE_ENV === 'development' && <WebMcpProvider />}
    </Suspense>
  )
}
