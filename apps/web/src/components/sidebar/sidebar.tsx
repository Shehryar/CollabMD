'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSession, signOut } from '@/lib/auth-client'
import { useState } from 'react'
import OrgSwitcher from '@/components/org/org-switcher'
import { useActiveOrganization } from '@/lib/auth-client'
import { FolderTree } from './folder-tree'
import { useSidebar } from './sidebar-context'
import { GettingStarted } from './getting-started'
import { NotificationBell } from './notification-bell'

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
            <div className="mt-2 flex items-center gap-[10px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-accent-subtle font-mono text-[11px] font-semibold text-accent">
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
                <Link
                  href="/settings/notifications"
                  onClick={() => setOpen(false)}
                  className="mt-0.5 inline-block font-mono text-[10.5px] text-fg-muted hover:text-fg"
                >
                  Notifications
                </Link>
              </div>
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
                className="shrink-0 text-xs text-fg-muted hover:text-fg"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
