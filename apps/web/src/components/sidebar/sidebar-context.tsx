'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useSession, useActiveOrganization } from '@/lib/auth-client'

export interface Folder {
  id: string
  orgId: string
  name: string
  path: string
  parentId: string | null
  createdBy: string
  createdAt: string
}

export interface Doc {
  id: string
  title: string
  orgId: string
  ownerId: string
  folderId: string | null
  updatedAt: string
  createdAt: string
}

interface SidebarState {
  open: boolean
  setOpen: (open: boolean) => void
  folders: Folder[]
  refreshFolders: () => Promise<void>
  docs: Doc[]
  refreshDocs: (params?: Record<string, string>) => Promise<void>
  loading: boolean
}

const SidebarContext = createContext<SidebarState | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const [open, setOpen] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)

  const orgId = activeOrg?.id ?? session?.session?.activeOrganizationId

  const refreshFolders = useCallback(async () => {
    if (!orgId) return
    const res = await fetch(`/api/folders?orgId=${orgId}`)
    if (res.ok) {
      setFolders(await res.json())
    }
  }, [orgId])

  const refreshDocs = useCallback(async (params?: Record<string, string>) => {
    const url = new URL('/api/documents', window.location.origin)
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    }
    const res = await fetch(url.toString())
    if (res.ok) {
      setDocs(await res.json())
    }
  }, [])

  useEffect(() => {
    if (orgId) {
      setLoading(true)
      Promise.all([refreshFolders(), refreshDocs()]).finally(() => setLoading(false))
    }
  }, [orgId, refreshFolders, refreshDocs])

  return (
    <SidebarContext.Provider
      value={{ open, setOpen, folders, refreshFolders, docs, refreshDocs, loading }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}
