'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient, useSession } from '@/lib/auth-client'
import InviteForm from '@/components/org/invite-form'

interface OrgSettingsProps {
  params: Promise<{ slug: string }>
}

interface OrgMember {
  id: string
  role: string
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
}

interface OrgData {
  id: string
  name: string
  slug: string
  members: OrgMember[]
}

type DocPermission = 'viewer' | 'commenter' | 'editor' | 'none'

const permissionOptions: { value: DocPermission; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' },
]

export default function OrgSettingsPage({ params }: OrgSettingsProps) {
  const { slug } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const [org, setOrg] = useState<OrgData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [defaultPerm, setDefaultPerm] = useState<DocPermission>('none')
  const [savingPerm, setSavingPerm] = useState(false)
  const [permSaved, setPermSaved] = useState(false)

  const currentUserRole = org?.members.find((m) => m.user.id === session?.user?.id)?.role
  const isAdminOrOwner = currentUserRole === 'admin' || currentUserRole === 'owner'

  useEffect(() => {
    async function load() {
      const { data, error: err } = await authClient.organization.setActive({
        organizationSlug: slug,
      })

      if (err || !data) {
        setError('Organization not found')
        setLoading(false)
        return
      }

      const { data: full, error: fullErr } = await authClient.organization.getFullOrganization()

      if (fullErr || !full) {
        setError('Failed to load organization details')
        setLoading(false)
        return
      }

      const orgData = full as unknown as OrgData
      setOrg(orgData)

      // Fetch org settings
      const res = await fetch(`/api/orgs/${orgData.id}/settings`)
      if (res.ok) {
        const settings = await res.json()
        setDefaultPerm(settings.defaultDocPermission ?? 'none')
      }

      setLoading(false)
    }
    load()
  }, [slug])

  async function saveDefaultPermission() {
    if (!org) return
    setSavingPerm(true)
    setPermSaved(false)
    try {
      const res = await fetch(`/api/orgs/${org.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultDocPermission: defaultPerm }),
      })
      if (res.ok) {
        setPermSaved(true)
        setTimeout(() => setPermSaved(false), 2000)
      }
    } finally {
      setSavingPerm(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    )
  }

  if (error || !org) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="mt-2 text-sm text-gray-500 hover:text-gray-700"
          >
            Go home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <button
          onClick={() => router.push('/')}
          className="mb-6 text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back
        </button>

        <h1 className="text-xl font-semibold text-gray-900">{org.name}</h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">{org.slug}</p>

        <section className="mt-8">
          <h2 className="text-sm font-medium text-gray-900">Members</h2>
          <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {org.members.map((member) => (
              <div key={member.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{member.user.name}</p>
                  <p className="text-xs text-gray-500">{member.user.email}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-medium text-gray-900">Invite member</h2>
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
            <InviteForm
              onInvited={() => {
                router.refresh()
              }}
            />
          </div>
        </section>

        {isAdminOrOwner && (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-gray-900">Document defaults</h2>
            <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
              <label className="block text-sm text-gray-700">
                Default permission for new documents
              </label>
              <p className="mt-1 text-xs text-gray-500">
                When a new document is created, all org members will automatically receive this role.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <select
                  value={defaultPerm}
                  onChange={(e) => setDefaultPerm(e.target.value as DocPermission)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-gray-400 focus:outline-none"
                >
                  {permissionOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={saveDefaultPermission}
                  disabled={savingPerm}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {savingPerm ? 'Saving...' : 'Save'}
                </button>
                {permSaved && (
                  <span className="text-xs text-green-600">Saved</span>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
