'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSession, signOut } from '@/lib/auth-client'
import OrgSwitcher from '@/components/org/org-switcher'
import { FolderTree } from './folder-tree'
import { useSidebar } from './sidebar-context'

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()
  const { open, setOpen } = useSidebar()

  const isActive = (path: string) => pathname === path && !searchParams.get('view') && !searchParams.get('folder')
  const isSharedView = searchParams.get('view') === 'shared'

  const createDoc = async () => {
    const activeOrgId = session?.session?.activeOrganizationId
    if (!activeOrgId) return
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', orgId: activeOrgId }),
    })
    if (res.ok) {
      const doc = await res.json()
      router.push(`/doc/${doc.id}`)
    }
  }

  const navLink = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      onClick={() => setOpen(false)}
      className={`flex items-center rounded-md px-2 py-1.5 text-sm ${
        active
          ? 'bg-gray-100 font-medium text-gray-900'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <Link href="/" className="text-sm font-semibold text-gray-900" onClick={() => setOpen(false)}>
            CollabMD
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-gray-400 hover:text-gray-600 lg:hidden"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New document button */}
        <div className="px-3 pt-3">
          <button
            onClick={createDoc}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New document
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {navLink('/', 'All Documents', isActive('/'))}
          {navLink('/?view=shared', 'Shared with me', isSharedView)}

          {/* Folder tree */}
          <FolderTree />

          {navLink('/trash', 'Trash', pathname === '/trash')}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 p-3 space-y-2">
          <OrgSwitcher />
          {session && (
            <div className="flex items-center justify-between">
              <span className="truncate text-xs text-gray-500">
                {session.user.email}
              </span>
              <button
                onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = '/login' } } })}
                className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
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
