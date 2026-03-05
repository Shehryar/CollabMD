'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  authClient,
  useSession,
  useActiveOrganization,
  useListOrganizations,
} from '@/lib/auth-client'

export interface Folder {
  id: string
  orgId: string
  name: string
  path: string
  parentId: string | null
  position: number
  createdBy: string
  createdAt: string
}

export interface OnboardingStatus {
  orgId: string
  orgName: string
  docCount: number
  memberCount: number
  hasDaemonEdits: boolean
}

export interface ConnectedFolder {
  folderId: string | null
  folderName: string
  status: 'synced' | 'syncing' | 'disconnected'
  fileCount: number
  lastSync: string
}

interface SidebarState {
  open: boolean
  setOpen: (open: boolean) => void
  folders: Folder[]
  refreshFolders: () => Promise<void>
  connectedFolders: ConnectedFolder[]
  refreshConnectedFolders: () => Promise<void>
  onboardingStatus: OnboardingStatus | null
  refreshOnboardingStatus: () => Promise<void>
  loading: boolean
  onboardingLoading: boolean
}

const SidebarContext = createContext<SidebarState | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const { data: orgs } = useListOrganizations()
  const autoActivated = useRef(false)
  const [open, setOpen] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [connectedFolders, setConnectedFolders] = useState<ConnectedFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null)
  const [onboardingLoading, setOnboardingLoading] = useState(true)

  // Auto-activate first org when user has orgs but none is active
  useEffect(() => {
    if (autoActivated.current) return
    if (!session?.user) return
    if (activeOrg?.id || session.session?.activeOrganizationId) return
    if (!orgs || orgs.length === 0) return

    autoActivated.current = true
    authClient.organization.setActive({ organizationId: orgs[0].id })
  }, [session, activeOrg, orgs])

  const orgId = activeOrg?.id ?? session?.session?.activeOrganizationId

  const refreshFolders = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await fetch(`/api/folders?orgId=${orgId}`)
      if (!res.ok) return
      setFolders(await res.json())
    } catch {
      // Keep existing state when refresh fails.
    }
  }, [orgId])

  const refreshOnboardingStatus = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await fetch(`/api/onboarding/status?orgId=${orgId}`)
      if (!res.ok) return
      setOnboardingStatus(await res.json())
    } catch {
      // Keep existing state when refresh fails.
    }
  }, [orgId])

  const refreshConnectedFolders = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await fetch('/api/connect/folders', { cache: 'no-store' })
      if (!res.ok) return
      setConnectedFolders(await res.json())
    } catch {
      // Keep existing state when refresh fails.
    }
  }, [orgId])

  useEffect(() => {
    if (!orgId) {
      setFolders([])
      setConnectedFolders([])
      setOnboardingStatus(null)
      setLoading(false)
      setOnboardingLoading(false)
      return
    }

    setLoading(true)
    setOnboardingLoading(true)
    refreshFolders().finally(() => setLoading(false))
    void refreshConnectedFolders()
    refreshOnboardingStatus().finally(() => setOnboardingLoading(false))
  }, [orgId, refreshFolders, refreshConnectedFolders, refreshOnboardingStatus])

  useEffect(() => {
    if (!orgId) return

    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return
      void refreshConnectedFolders()
    }

    const interval = window.setInterval(refreshIfVisible, 30_000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [orgId, refreshConnectedFolders])

  return (
    <SidebarContext.Provider
      value={{
        open,
        setOpen,
        folders,
        refreshFolders,
        connectedFolders,
        refreshConnectedFolders,
        onboardingStatus,
        refreshOnboardingStatus,
        loading,
        onboardingLoading,
      }}
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
