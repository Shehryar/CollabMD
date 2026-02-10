'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authClient, useActiveOrganization, useListOrganizations } from '@/lib/auth-client'

export default function OrgSwitcher() {
  const router = useRouter()
  const { data: activeOrg } = useActiveOrganization()
  const { data: orgs } = useListOrganizations()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function switchOrg(orgId: string) {
    await authClient.organization.setActive({ organizationId: orgId })
    setOpen(false)
    router.refresh()
  }

  const orgList = orgs ?? []
  const activeName = activeOrg?.name ?? 'Select org'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        <span className="max-w-[150px] truncate">{activeName}</span>
        <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {orgList.map((org) => (
            <button
              key={org.id}
              onClick={() => switchOrg(org.id)}
              className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                org.id === activeOrg?.id ? 'font-medium text-gray-900' : 'text-gray-600'
              }`}
            >
              <span className="truncate">{org.name}</span>
              {org.id === activeOrg?.id && (
                <svg className="ml-auto h-4 w-4 text-gray-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}

          <div className="border-t border-gray-100 pt-1 mt-1">
            <button
              onClick={() => {
                setOpen(false)
                router.push('/org/new')
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50"
            >
              + New organization
            </button>
            {activeOrg?.slug && (
              <button
                onClick={() => {
                  setOpen(false)
                  router.push(`/org/${activeOrg.slug}/settings`)
                }}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50"
              >
                Settings
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
