'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSession, signOut } from '@/lib/auth-client'
import { useEffect, useRef, useState } from 'react'
import OrgSwitcher from '@/components/org/org-switcher'
import { useActiveOrganization } from '@/lib/auth-client'
import { FolderTree } from './folder-tree'
import { useSidebar } from './sidebar-context'
import { GettingStarted } from './getting-started'
import { NotificationBell } from './notification-bell'
import { useKeyboardShortcuts } from '@/components/keyboard-shortcut-provider'

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()
  const { open, setOpen, onboardingStatus, onboardingLoading, refreshOnboardingStatus } =
    useSidebar()
  const { data: activeOrg } = useActiveOrganization()
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const { setShortcutHelpOpen } = useKeyboardShortcuts()

  const isActive = (path: string) =>
    pathname === path && !searchParams.get('view') && !searchParams.get('folder')
  const isSharedView = searchParams.get('view') === 'shared'

  const createDoc = async () => {
    if (creatingDoc) return

    const activeOrgId = activeOrg?.id ?? session?.session?.activeOrganizationId
    if (!activeOrgId) {
      setCreateError('Select a workspace before creating a document.')
      return
    }

    setCreateError(null)
    setCreatingDoc(true)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', orgId: activeOrgId }),
      })
      if (!res.ok) {
        let nextError = 'Failed to create document.'
        try {
          const body = (await res.json()) as { error?: unknown }
          if (typeof body.error === 'string' && body.error.trim()) {
            nextError = body.error
          }
        } catch {
          // Use fallback message when API response body is not JSON.
        }
        setCreateError(nextError)
        return
      }
      const doc = await res.json()
      window.dispatchEvent(new Event('collabmd:documents-changed'))
      window.dispatchEvent(
        new CustomEvent('collabmd:document-created', {
          detail: {
            id: doc.id,
            title: doc.title ?? 'Untitled',
            folderId: doc.folderId ?? null,
          },
        }),
      )
      router.push(`/doc/${doc.id}`)
      void refreshOnboardingStatus()
    } catch {
      setCreateError('Failed to create document.')
    } finally {
      setCreatingDoc(false)
    }
  }

  const navLink = (href: string, label: string, active: boolean, icon: React.ReactNode) => (
    <Link
      href={href}
      onClick={() => setOpen(false)}
      className={`flex items-center gap-2 rounded px-[10px] py-[7px] font-sans text-[13px] font-medium ${
        active ? 'bg-bg text-fg shadow-sm' : 'text-fg-secondary hover:bg-bg-hover hover:text-fg'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${active ? 'opacity-80' : 'opacity-50 group-hover:opacity-80'}`}
      >
        {icon}
      </span>
      {label}
    </Link>
  )

  const userInitial =
    session?.user?.name?.charAt(0)?.toUpperCase() ??
    session?.user?.email?.charAt(0)?.toUpperCase() ??
    '?'

  useEffect(() => {
    if (!accountMenuOpen) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && accountMenuRef.current?.contains(target)) return
      setAccountMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [accountMenuOpen])

  const workspaceHref = activeOrg?.slug ? `/org/${activeOrg.slug}/settings` : '/org/new'

  const drawerLinkClass =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-bg-hover'

  const drawerIconClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle text-fg-secondary'

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setOpen(false)} />
      )}

      <aside
        role="navigation"
        aria-label="sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-border bg-bg-subtle transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 pb-3 pt-4">
          <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-sm bg-fg font-mono text-xs font-bold text-bg">
              #
            </span>
            <span className="font-mono text-[15px] font-semibold tracking-[-0.02em] text-fg">
              collabmd
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell
              userId={session?.user?.id}
              orgId={activeOrg?.id ?? session?.session?.activeOrganizationId}
              onNavigate={() => setOpen(false)}
            />
            <button
              onClick={() => void createDoc()}
              disabled={creatingDoc}
              className="rounded border border-border-strong bg-bg px-[10px] py-[5px] font-mono text-xs font-medium text-fg hover:border-fg hover:bg-fg hover:text-bg disabled:opacity-50"
            >
              {creatingDoc ? '...' : '+ new'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-fg-muted hover:text-fg lg:hidden"
              aria-label="close sidebar"
              aria-expanded={open}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {createError && (
          <div className="mx-3 mt-2 rounded border border-border bg-red-subtle px-2 py-1 font-mono text-[11px] text-red">
            {createError}
          </div>
        )}

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="primary">
          {navLink(
            '/',
            'All documents',
            isActive('/'),
            <svg
              className="h-4 w-4"
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
            </svg>,
          )}
          {navLink(
            '/?view=shared',
            'Shared with me',
            isSharedView,
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
              />
            </svg>,
          )}
          <FolderTree />
          {navLink(
            '/trash',
            'Trash',
            pathname === '/trash',
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>,
          )}

          {navLink(
            '/connect',
            'Connect folder',
            pathname === '/connect',
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 7.5h10.5A2.25 2.25 0 0119.5 9.75v4.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 14.25v-4.5A2.25 2.25 0 016.75 7.5z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 12h7.5M12 8.25V15.75" />
            </svg>,
          )}

          {!onboardingLoading && onboardingStatus && (
            <GettingStarted
              orgId={onboardingStatus.orgId}
              orgName={onboardingStatus.orgName}
              orgSlug={activeOrg?.slug}
              docCount={onboardingStatus.docCount}
              memberCount={onboardingStatus.memberCount}
              hasDaemonEdits={onboardingStatus.hasDaemonEdits}
              onCreateDocument={createDoc}
            />
          )}
        </nav>

        <div className="mt-auto shrink-0 border-t border-border p-3">
          <OrgSwitcher />
          {session && (
            <div ref={accountMenuRef} className="relative mt-2">
              {accountMenuOpen && (
                <div
                  className="absolute inset-x-0 bottom-full z-50 mb-2 origin-bottom overflow-hidden rounded-2xl border border-border bg-bg/95 shadow-lg backdrop-blur-sm motion-safe:animate-[accountDrawerIn_180ms_cubic-bezier(0.22,1,0.36,1)]"
                  role="dialog"
                  aria-label="Account drawer"
                >
                  <div className="flex justify-center border-b border-border px-3 pb-2 pt-2">
                    <span className="h-1 w-10 rounded-full bg-border-strong" />
                  </div>
                  <div className="border-b border-border px-3 py-3">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
                      Account
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-accent-subtle font-mono text-[12px] font-semibold text-accent">
                        {userInitial}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-fg">
                          {session.user.name ?? session.user.email}
                        </p>
                        <p className="truncate text-[12px] text-fg-muted">{session.user.email}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 px-2 py-2">
                    <div>
                      <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                        Workspace
                      </p>
                      <Link
                        href={workspaceHref}
                        onClick={() => {
                          setAccountMenuOpen(false)
                          setOpen(false)
                        }}
                        className={drawerLinkClass}
                      >
                        <span className={drawerIconClass}>
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h10.5" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-fg">
                            {activeOrg?.name ?? 'Choose workspace'}
                          </span>
                          <span className="block text-[12px] text-fg-muted">
                            Manage workspace members and settings
                          </span>
                        </span>
                      </Link>
                    </div>

                    <div>
                      <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                        Preferences
                      </p>
                      <div className="space-y-1">
                        <Link
                          href="/settings"
                          onClick={() => {
                            setAccountMenuOpen(false)
                            setOpen(false)
                          }}
                          className={drawerLinkClass}
                        >
                          <span className={drawerIconClass}>
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 1115 0 7.5 7.5 0 01-15 0zm7.5-3.75v3.75l2.25 2.25" />
                            </svg>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-fg">Settings</span>
                            <span className="block text-[12px] text-fg-muted">
                              Theme, profile, and personal preferences
                            </span>
                          </span>
                        </Link>

                        <Link
                          href="/settings"
                          onClick={() => {
                            setAccountMenuOpen(false)
                            setOpen(false)
                          }}
                          className={drawerLinkClass}
                        >
                          <span className={drawerIconClass}>
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0018 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 00-2.31 6.022 23.848 23.848 0 005.454 1.31m5.713 0a24.255 24.255 0 01-5.713 0m5.713 0a3 3 0 11-5.713 0" />
                            </svg>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-fg">Notifications</span>
                            <span className="block text-[12px] text-fg-muted">
                              Email preferences and activity alerts
                            </span>
                          </span>
                        </Link>

                        <button
                          type="button"
                          onClick={() => {
                            setAccountMenuOpen(false)
                            setShortcutHelpOpen(true)
                          }}
                          className={drawerLinkClass}
                        >
                          <span className={drawerIconClass}>
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5A2.25 2.25 0 0119.5 9.75v4.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 14.25v-4.5A2.25 2.25 0 016.75 7.5z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 11.25h.008v.008H8.25v-.008zm3.746 0h.008v.008h-.008v-.008zm3.746 0h.008v.008h-.008v-.008z" />
                            </svg>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-fg">Keyboard shortcuts</span>
                            <span className="block text-[12px] text-fg-muted">
                              See navigation and editor command keys
                            </span>
                          </span>
                          <span className="shrink-0 rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                            ⌘/
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border p-2">
                    <button
                      onClick={() =>
                        signOut({
                          fetchOptions: {
                            onSuccess: () => {
                              window.location.href = '/login'
                            },
                          },
                        })
                      }
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-red-subtle"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle text-red">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H9m0 0l3-3m-3 3l3 3" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-fg">Sign out</span>
                        <span className="block text-[12px] text-fg-muted">End this session on this device</span>
                      </span>
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={() => setAccountMenuOpen((open) => !open)}
                className={`flex w-full items-center gap-[10px] rounded border px-2.5 py-2 text-left transition-all ${
                  accountMenuOpen
                    ? 'border-border-strong bg-bg-hover shadow-sm'
                    : 'border-border bg-bg hover:bg-bg-hover'
                }`}
                aria-haspopup="dialog"
                aria-expanded={accountMenuOpen}
                aria-label="Account menu"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-accent-subtle font-mono text-[11px] font-semibold text-accent">
                  {userInitial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">
                    {session.user.name ?? session.user.email}
                  </p>
                  {activeOrg?.name && (
                    <p className="truncate font-mono text-[11px] tracking-[-0.01em] text-fg-muted">
                      {activeOrg.name}
                    </p>
                  )}
                </div>
                <svg
                  className={`h-4 w-4 shrink-0 text-fg-faint transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>
      <style jsx>{`
        @keyframes accountDrawerIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </>
  )
}
