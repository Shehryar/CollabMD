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
type AgentPolicy = 'enabled' | 'restricted' | 'disabled'

const permissionOptions: { value: DocPermission; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' },
]

const agentPolicyOptions: { value: AgentPolicy; label: string }[] = [
  { value: 'enabled', label: 'Enabled - agents can edit all documents' },
  { value: 'restricted', label: 'Restricted - agents can only edit documents marked as agent-editable' },
  { value: 'disabled', label: 'Disabled - agent editing is blocked' },
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
  const [permError, setPermError] = useState('')
  const [agentPolicy, setAgentPolicy] = useState<AgentPolicy>('enabled')
  const [savingAgentPolicy, setSavingAgentPolicy] = useState(false)
  const [agentPolicySaved, setAgentPolicySaved] = useState(false)
  const [agentPolicyError, setAgentPolicyError] = useState('')

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

      try {
        const res = await fetch(`/api/orgs/${orgData.id}/settings`)
        if (res.ok) {
          const settings = await res.json()
          setDefaultPerm(settings.defaultDocPermission ?? 'none')
          setAgentPolicy(settings.agentPolicy ?? 'enabled')
        }
      } catch {
        setError('Failed to load organization settings')
      }

      setLoading(false)
    }
    load()
  }, [slug])

  async function saveDefaultPermission() {
    if (!org) return
    setSavingPerm(true)
    setPermSaved(false)
    setPermError('')
    try {
      const res = await fetch(`/api/orgs/${org.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultDocPermission: defaultPerm }),
      })
      if (res.ok) {
        setPermSaved(true)
        setTimeout(() => setPermSaved(false), 2000)
      } else {
        setPermError('Failed to save default permission')
      }
    } catch {
      setPermError('Failed to save default permission')
    } finally {
      setSavingPerm(false)
    }
  }

  async function saveAgentPolicy(nextPolicy: AgentPolicy) {
    if (!org || savingAgentPolicy) return
    const previous = agentPolicy
    setAgentPolicy(nextPolicy)
    setSavingAgentPolicy(true)
    setAgentPolicySaved(false)
    setAgentPolicyError('')
    try {
      const res = await fetch(`/api/orgs/${org.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentPolicy: nextPolicy }),
      })
      if (res.ok) {
        setAgentPolicySaved(true)
        setTimeout(() => setAgentPolicySaved(false), 2000)
      } else {
        setAgentPolicy(previous)
        setAgentPolicyError('Failed to save agent access policy')
      }
    } catch {
      setAgentPolicy(previous)
      setAgentPolicyError('Failed to save agent access policy')
    } finally {
      setSavingAgentPolicy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
        <p className="font-sans text-sm text-fg-muted">Loading...</p>
      </div>
    )
  }

  if (error || !org) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
        <div className="text-center">
          <p className="text-sm text-red">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="mt-2 font-mono text-[11px] text-fg-muted hover:text-fg"
          >
            Go home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-subtle">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <button
          onClick={() => router.push('/')}
          className="mb-6 font-mono text-[11px] text-fg-muted hover:text-fg"
        >
          &larr; Back
        </button>

        <h1 className="font-mono text-[18px] font-semibold tracking-[-0.03em] text-fg">{org.name}</h1>
        <p className="mt-1 font-mono text-sm text-fg-muted">{org.slug}</p>

        <section className="mt-8">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Members</h2>
          <div className="mt-3 divide-y divide-border rounded border border-border bg-bg">
            {org.members.map((member) => (
              <div key={member.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-sans text-sm font-medium text-fg">{member.user.name}</p>
                  <p className="font-mono text-[11px] text-fg-muted">{member.user.email}</p>
                </div>
                <span className="rounded-sm border border-border bg-bg-subtle px-[7px] py-[2px] font-mono text-[10px] font-medium text-fg-secondary">
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Invite member</h2>
          <div className="mt-3 rounded border border-border bg-bg p-4">
            <InviteForm
              onInvited={() => {
                router.refresh()
              }}
            />
          </div>
        </section>

        {isAdminOrOwner && (
          <section className="mt-8">
            <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Document defaults</h2>
            <div className="mt-3 rounded border border-border bg-bg p-4">
              <label className="block font-sans text-sm text-fg">
                Default permission for new documents
              </label>
              <p className="mt-1 font-sans text-xs text-fg-secondary">
                When a new document is created, all org members will automatically receive this role.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <select
                  value={defaultPerm}
                  onChange={(e) => setDefaultPerm(e.target.value as DocPermission)}
                  className="rounded border border-border bg-bg px-3 py-1.5 font-mono text-sm text-fg focus:border-fg focus:outline-none"
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
                  className="rounded bg-fg px-4 py-[7px] font-mono text-[12.5px] font-medium text-bg hover:bg-[#333] disabled:opacity-50"
                >
                  {savingPerm ? 'Saving...' : 'Save'}
                </button>
                {permSaved && (
                  <span className="text-xs text-green">Saved</span>
                )}
                {permError && (
                  <span className="text-xs text-red">{permError}</span>
                )}
              </div>
            </div>
          </section>
        )}

        {isAdminOrOwner && (
          <section className="mt-8">
            <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Agent access</h2>
            <div className="mt-3 rounded border border-border bg-bg p-4">
              <label className="block font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">
                AGENT ACCESS POLICY
              </label>
              <p className="mt-1 text-fg-muted text-xs font-sans">
                Controls whether AI agents connected via the CLI daemon can edit documents in this workspace.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <select
                  value={agentPolicy}
                  onChange={(e) => {
                    void saveAgentPolicy(e.target.value as AgentPolicy)
                  }}
                  className="rounded border border-border bg-bg px-3 py-1.5 font-mono text-sm text-fg focus:border-fg focus:outline-none"
                >
                  {agentPolicyOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {savingAgentPolicy && (
                  <span className="text-xs text-fg-muted">Saving...</span>
                )}
                {agentPolicySaved && (
                  <span className="text-xs text-green">Saved</span>
                )}
                {agentPolicyError && (
                  <span className="text-xs text-red">{agentPolicyError}</span>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
