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
type AgentPolicy = 'enabled' | 'suggest-only' | 'restricted' | 'disabled'
type SettingsTab = 'general' | 'agents' | 'webhooks' | 'api-keys'

interface AgentRegistryEntry {
  name: string
  description: string
  enabled: boolean
}

interface WebhookRecord {
  id: string
  url: string
  events: string[]
  createdAt: string
  active: boolean
}

interface WebhookDelivery {
  id: string
  eventType: string
  statusCode: number | null
  responseBody: string | null
  attemptCount: number
  lastAttemptAt: string
}

interface ApiKeyRecord {
  id: string
  keyPrefix: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

const webhookEventOptions = [
  'document.edited',
  'comment.created',
  'comment.mention',
  'suggestion.created',
  'suggestion.accepted',
  'suggestion.dismissed',
  'discussion.created',
] as const

const permissionOptions: { value: DocPermission; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' },
]

const agentPolicyOptions: { value: AgentPolicy; label: string }[] = [
  { value: 'enabled', label: 'Enabled - agents can edit all documents' },
  { value: 'suggest-only', label: 'Suggest only - agents can only propose changes via suggestions' },
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [agents, setAgents] = useState<AgentRegistryEntry[]>([])
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentDescription, setNewAgentDescription] = useState('')
  const [agentSaveState, setAgentSaveState] = useState<{ saving: boolean; error: string; saved: boolean }>({
    saving: false,
    error: '',
    saved: false,
  })
  const [webhooks, setWebhooks] = useState<WebhookRecord[]>([])
  const [newWebhookUrl, setNewWebhookUrl] = useState('')
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(['document.edited'])
  const [webhookError, setWebhookError] = useState('')
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null)
  const [loadingWebhooks, setLoadingWebhooks] = useState(false)
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyDocScopes, setNewKeyDocScopes] = useState('')
  const [newKeyFolderScopes, setNewKeyFolderScopes] = useState('')
  const [apiKeyError, setApiKeyError] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [connectName, setConnectName] = useState('')
  const [connectDescription, setConnectDescription] = useState('')
  const [connectWebhookUrl, setConnectWebhookUrl] = useState('')
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [connectResult, setConnectResult] = useState<{
    apiKey: string
    webhookSecret?: string
    serverUrl: string
    agentName: string
  } | null>(null)

  const currentUserRole = org?.members.find((m) => m.user.id === session?.user?.id)?.role
  const isAdminOrOwner = currentUserRole === 'admin' || currentUserRole === 'owner'

  async function loadWebhooks(orgId: string) {
    setLoadingWebhooks(true)
    setWebhookError('')
    try {
      const res = await fetch(`/api/orgs/${orgId}/webhooks`)
      if (!res.ok) {
        setWebhookError('Failed to load webhooks')
        return
      }
      const rows = await res.json() as WebhookRecord[]
      setWebhooks(rows)
    } catch {
      setWebhookError('Failed to load webhooks')
    } finally {
      setLoadingWebhooks(false)
    }
  }

  async function loadApiKeys(orgId: string) {
    setApiKeyError('')
    try {
      const res = await fetch(`/api/orgs/${orgId}/agent-keys`)
      if (!res.ok) {
        setApiKeyError('Failed to load API keys')
        return
      }
      const rows = await res.json() as ApiKeyRecord[]
      setApiKeys(rows)
    } catch {
      setApiKeyError('Failed to load API keys')
    }
  }

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
          const settings = await res.json() as {
            defaultDocPermission?: DocPermission
            agentPolicy?: AgentPolicy
            agents?: AgentRegistryEntry[]
          }
          setDefaultPerm(settings.defaultDocPermission ?? 'none')
          setAgentPolicy(settings.agentPolicy ?? 'enabled')
          setAgents(Array.isArray(settings.agents) ? settings.agents : [])
        }
      } catch {
        setError('Failed to load organization settings')
      }

      if (orgData.members.some((member) => member.user.id === session?.user?.id && (member.role === 'admin' || member.role === 'owner'))) {
        await Promise.all([
          loadWebhooks(orgData.id),
          loadApiKeys(orgData.id),
        ])
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

  async function saveAgents(nextAgents: AgentRegistryEntry[]) {
    if (!org) return
    setAgentSaveState({ saving: true, error: '', saved: false })
    try {
      const res = await fetch(`/api/orgs/${org.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: nextAgents }),
      })
      if (!res.ok) {
        setAgentSaveState({ saving: false, error: 'Failed to save agents', saved: false })
        return
      }
      setAgents(nextAgents)
      setAgentSaveState({ saving: false, error: '', saved: true })
      setTimeout(() => setAgentSaveState({ saving: false, error: '', saved: false }), 2000)
    } catch {
      setAgentSaveState({ saving: false, error: 'Failed to save agents', saved: false })
    }
  }

  async function createWebhook() {
    if (!org) return
    setWebhookError('')
    setCreatedWebhookSecret(null)
    try {
      const res = await fetch(`/api/orgs/${org.id}/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newWebhookUrl,
          events: newWebhookEvents,
        }),
      })
      if (!res.ok) {
        setWebhookError('Failed to create webhook')
        return
      }
      const created = await res.json() as { secret?: string }
      if (typeof created.secret === 'string' && created.secret) {
        setCreatedWebhookSecret(created.secret)
      }
      setNewWebhookUrl('')
      setNewWebhookEvents(['document.edited'])
      await loadWebhooks(org.id)
    } catch {
      setWebhookError('Failed to create webhook')
    }
  }

  async function deleteWebhook(webhookId: string) {
    if (!org) return
    setWebhookError('')
    try {
      const res = await fetch(`/api/orgs/${org.id}/webhooks/${webhookId}`, { method: 'DELETE' })
      if (!res.ok) {
        setWebhookError('Failed to delete webhook')
        return
      }
      if (selectedWebhookId === webhookId) {
        setSelectedWebhookId(null)
        setDeliveries([])
      }
      await loadWebhooks(org.id)
    } catch {
      setWebhookError('Failed to delete webhook')
    }
  }

  async function loadDeliveries(webhookId: string) {
    if (!org) return
    setWebhookError('')
    try {
      const res = await fetch(`/api/orgs/${org.id}/webhooks/${webhookId}/deliveries`)
      if (!res.ok) {
        setWebhookError('Failed to load deliveries')
        return
      }
      const rows = await res.json() as WebhookDelivery[]
      setSelectedWebhookId(webhookId)
      setDeliveries(rows)
    } catch {
      setWebhookError('Failed to load deliveries')
    }
  }

  async function createApiKey() {
    if (!org) return
    setApiKeyError('')
    setCreatedKey(null)
    const docs = newKeyDocScopes.split(',').map((entry) => entry.trim()).filter(Boolean)
    const folders = newKeyFolderScopes.split(',').map((entry) => entry.trim()).filter(Boolean)
    try {
      const res = await fetch(`/api/orgs/${org.id}/agent-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName,
          scopes: {
            documents: docs.length > 0 ? docs : undefined,
            folders: folders.length > 0 ? folders : undefined,
          },
        }),
      })
      if (!res.ok) {
        setApiKeyError('Failed to create API key')
        return
      }
      const created = await res.json() as { key: string }
      setCreatedKey(created.key)
      setNewKeyName('')
      setNewKeyDocScopes('')
      setNewKeyFolderScopes('')
      await loadApiKeys(org.id)
    } catch {
      setApiKeyError('Failed to create API key')
    }
  }

  async function revokeApiKey(keyId: string) {
    if (!org) return
    setApiKeyError('')
    try {
      const res = await fetch(`/api/orgs/${org.id}/agent-keys/${keyId}`, { method: 'DELETE' })
      if (!res.ok) {
        setApiKeyError('Failed to revoke API key')
        return
      }
      await loadApiKeys(org.id)
    } catch {
      setApiKeyError('Failed to revoke API key')
    }
  }

  async function connectAgent() {
    if (!org || connectLoading) return
    setConnectLoading(true)
    setConnectError('')
    setConnectResult(null)
    try {
      const body: Record<string, string> = { name: connectName.trim().replace(/^@+/, '') }
      if (connectDescription.trim()) body.description = connectDescription.trim()
      if (connectWebhookUrl.trim()) body.webhookUrl = connectWebhookUrl.trim()

      const res = await fetch(`/api/orgs/${org.id}/connect-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setConnectError(data.error || 'Failed to connect agent')
        return
      }
      const result = await res.json()
      setConnectResult(result)
      setConnectName('')
      setConnectDescription('')
      setConnectWebhookUrl('')
      // Reload agents list and API keys
      const settingsRes = await fetch(`/api/orgs/${org.id}/settings`)
      if (settingsRes.ok) {
        const settings = await settingsRes.json() as { agents?: AgentRegistryEntry[] }
        setAgents(Array.isArray(settings.agents) ? settings.agents : [])
      }
      await loadApiKeys(org.id)
    } catch {
      setConnectError('Failed to connect agent')
    } finally {
      setConnectLoading(false)
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
        {isAdminOrOwner && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsTab('general')}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] ${settingsTab === 'general' ? 'border-accent bg-accent text-accent-text' : 'border-border bg-bg text-fg-secondary hover:bg-bg-subtle'}`}
            >
              General
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('agents')}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] ${settingsTab === 'agents' ? 'border-accent bg-accent text-accent-text' : 'border-border bg-bg text-fg-secondary hover:bg-bg-subtle'}`}
            >
              Agents
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('webhooks')}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] ${settingsTab === 'webhooks' ? 'border-accent bg-accent text-accent-text' : 'border-border bg-bg text-fg-secondary hover:bg-bg-subtle'}`}
            >
              Webhooks
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('api-keys')}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] ${settingsTab === 'api-keys' ? 'border-accent bg-accent text-accent-text' : 'border-border bg-bg text-fg-secondary hover:bg-bg-subtle'}`}
            >
              API Keys
            </button>
          </div>
        )}

        {(!isAdminOrOwner || settingsTab === 'general') && (
          <>
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
              <>
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
              </>
            )}
          </>
        )}

        {isAdminOrOwner && settingsTab === 'agents' && (
          <section className="mt-8">
            <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Agent registry</h2>
            <div className="mt-3 rounded border border-border bg-bg p-4">
              <div className="space-y-2">
                {agents.map((agent) => (
                  <div key={agent.name} className="rounded border border-border bg-bg-subtle px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-[11px] text-fg">@{agent.name}</p>
                        <p className="text-xs text-fg-muted">{agent.description || 'No description'}</p>
                      </div>
                      <label className="flex items-center gap-1.5 font-mono text-[10px] text-fg-secondary">
                        Enabled
                        <input
                          type="checkbox"
                          checked={agent.enabled}
                          onChange={(event) => {
                            const next = agents.map((entry) => (
                              entry.name === agent.name ? { ...entry, enabled: event.target.checked } : entry
                            ))
                            void saveAgents(next)
                          }}
                          className="h-3.5 w-3.5"
                        />
                      </label>
                    </div>
                  </div>
                ))}
                {agents.length === 0 && (
                  <p className="text-xs text-fg-muted">No agents registered.</p>
                )}
              </div>

              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">Add agent</p>
                <input
                  value={newAgentName}
                  onChange={(event) => setNewAgentName(event.target.value)}
                  placeholder="Agent name (without @)"
                  className="w-full rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  value={newAgentDescription}
                  onChange={(event) => setNewAgentDescription(event.target.value)}
                  placeholder="Description"
                  className="w-full rounded border border-border bg-bg px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const name = newAgentName.trim().replace(/^@+/, '')
                      if (!name) return
                      const next = [...agents, { name, description: newAgentDescription.trim(), enabled: true }]
                      void saveAgents(next)
                      setNewAgentName('')
                      setNewAgentDescription('')
                    }}
                    disabled={agentSaveState.saving}
                    className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-accent-text disabled:opacity-55"
                  >
                    {agentSaveState.saving ? 'Saving...' : 'Add agent'}
                  </button>
                  {agentSaveState.saved && <span className="text-xs text-green">Saved</span>}
                  {agentSaveState.error && <span className="text-xs text-red">{agentSaveState.error}</span>}
                </div>
              </div>
            </div>
          </section>
        )}

        {isAdminOrOwner && settingsTab === 'agents' && (
          <section className="mt-8">
            <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Connect agent</h2>
            <p className="mt-1 font-sans text-xs text-fg-secondary">
              Set up a new agent with API key and webhook in one step.
            </p>
            <div className="mt-3 rounded border border-border bg-bg p-4 space-y-2">
              <input
                value={connectName}
                onChange={(e) => setConnectName(e.target.value)}
                placeholder="Agent name (without @)"
                className="w-full rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={connectDescription}
                onChange={(e) => setConnectDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full rounded border border-border bg-bg px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={connectWebhookUrl}
                onChange={(e) => setConnectWebhookUrl(e.target.value)}
                placeholder="Webhook URL (optional, for remote agents)"
                className="w-full rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void connectAgent()}
                  disabled={!connectName.trim() || connectLoading}
                  className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-accent-text disabled:opacity-55"
                >
                  {connectLoading ? 'Connecting...' : 'Connect agent'}
                </button>
                {connectError && <span className="text-xs text-red">{connectError}</span>}
              </div>
            </div>

            {connectResult && (
              <div className="mt-3 rounded border border-accent/40 bg-bg-subtle p-4 space-y-3">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">
                  Copy these credentials now. The API key will not be shown again.
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="font-mono text-[10px] text-fg-muted">Agent Name</p>
                    <p className="font-mono text-xs text-fg">@{connectResult.agentName}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] text-fg-muted">API Key</p>
                    <p className="break-all font-mono text-xs text-fg">{connectResult.apiKey}</p>
                  </div>
                  {connectResult.webhookSecret && (
                    <div>
                      <p className="font-mono text-[10px] text-fg-muted">Webhook Secret</p>
                      <p className="break-all font-mono text-xs text-fg">{connectResult.webhookSecret}</p>
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-[10px] text-fg-muted">Server URL</p>
                    <p className="break-all font-mono text-xs text-fg">{connectResult.serverUrl}</p>
                  </div>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="font-mono text-[10px] text-fg-muted">For local agents, add to collabmd.json:</p>
                  <pre className="mt-1 rounded border border-border bg-bg p-2 font-mono text-[10px] text-fg overflow-x-auto">
{`collabmd agent add ${connectResult.agentName} --command "your-command-here"`}
                  </pre>
                </div>
              </div>
            )}
          </section>
        )}

        {isAdminOrOwner && settingsTab === 'webhooks' && (
          <section className="mt-8">
            <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Webhooks</h2>
            <div className="mt-3 rounded border border-border bg-bg p-4 space-y-3">
              <div className="space-y-2">
                <input
                  value={newWebhookUrl}
                  onChange={(event) => setNewWebhookUrl(event.target.value)}
                  placeholder="https://example.com/webhook"
                  className="w-full rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-2">
                  {webhookEventOptions.map((eventType) => (
                    <label key={eventType} className="flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary">
                      <input
                        type="checkbox"
                        checked={newWebhookEvents.includes(eventType)}
                        onChange={(event) => {
                          setNewWebhookEvents((previous) => {
                            if (event.target.checked) return [...previous, eventType]
                            return previous.filter((entry) => entry !== eventType)
                          })
                        }}
                        className="h-3 w-3"
                      />
                      {eventType}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void createWebhook()}
                  disabled={!newWebhookUrl.trim()}
                  className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-accent-text disabled:opacity-55"
                >
                  Create webhook
                </button>
              </div>

              {createdWebhookSecret && (
                <div className="rounded border border-accent/40 bg-bg-subtle p-3">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">Copy now (shown once)</p>
                  <p className="mt-1 break-all font-mono text-xs text-fg">{createdWebhookSecret}</p>
                </div>
              )}

              {loadingWebhooks ? (
                <p className="text-xs text-fg-muted">Loading webhooks...</p>
              ) : (
                <div className="space-y-2">
                  {webhooks.map((webhook) => (
                    <div key={webhook.id} className="rounded border border-border bg-bg-subtle px-3 py-2">
                      <p className="font-mono text-[11px] text-fg">{webhook.url}</p>
                      <p className="mt-1 font-mono text-[10px] text-fg-muted">Events: {webhook.events.join(', ')}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void loadDeliveries(webhook.id)}
                          className="rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary hover:bg-bg"
                        >
                          Deliveries
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteWebhook(webhook.id)}
                          className="rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary hover:bg-bg"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {webhooks.length === 0 && (
                    <p className="text-xs text-fg-muted">No webhooks configured.</p>
                  )}
                </div>
              )}

              {selectedWebhookId && (
                <div className="rounded border border-border bg-bg-subtle p-3">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">
                    Delivery log ({selectedWebhookId})
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {deliveries.map((delivery) => (
                      <div key={delivery.id} className="rounded border border-border bg-bg px-2 py-1.5">
                        <p className="font-mono text-[10px] text-fg">{delivery.eventType}</p>
                        <p className="text-[11px] text-fg-muted">
                          status {delivery.statusCode ?? 'n/a'} · attempt {delivery.attemptCount} · {new Date(delivery.lastAttemptAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                    {deliveries.length === 0 && <p className="text-xs text-fg-muted">No deliveries yet.</p>}
                  </div>
                </div>
              )}
              {webhookError && <p className="text-xs text-red">{webhookError}</p>}
            </div>
          </section>
        )}

        {isAdminOrOwner && settingsTab === 'api-keys' && (
          <section className="mt-8">
            <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-fg-muted">Agent API keys</h2>
            <div className="mt-3 rounded border border-border bg-bg p-4 space-y-3">
              <div className="space-y-2">
                <input
                  value={newKeyName}
                  onChange={(event) => setNewKeyName(event.target.value)}
                  placeholder="Key name"
                  className="w-full rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  value={newKeyDocScopes}
                  onChange={(event) => setNewKeyDocScopes(event.target.value)}
                  placeholder="Document scopes (comma-separated IDs, optional)"
                  className="w-full rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  value={newKeyFolderScopes}
                  onChange={(event) => setNewKeyFolderScopes(event.target.value)}
                  placeholder="Folder scopes (comma-separated IDs, optional)"
                  className="w-full rounded border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void createApiKey()}
                  disabled={!newKeyName.trim()}
                  className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-accent-text disabled:opacity-55"
                >
                  Create key
                </button>
              </div>

              {createdKey && (
                <div className="rounded border border-accent/40 bg-bg-subtle p-3">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-muted">Copy now (shown once)</p>
                  <p className="mt-1 break-all font-mono text-xs text-fg">{createdKey}</p>
                </div>
              )}

              <div className="space-y-2">
                {apiKeys.map((key) => (
                  <div key={key.id} className="rounded border border-border bg-bg-subtle px-3 py-2">
                    <p className="font-mono text-[11px] text-fg">{key.name} · {key.keyPrefix}</p>
                    <p className="text-[11px] text-fg-muted">
                      Created {new Date(key.createdAt).toLocaleString()}
                      {key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}` : ' · Never used'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void revokeApiKey(key.id)}
                      className="mt-2 rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary hover:bg-bg"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
                {apiKeys.length === 0 && <p className="text-xs text-fg-muted">No active API keys.</p>}
              </div>
              {apiKeyError && <p className="text-xs text-red">{apiKeyError}</p>}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
