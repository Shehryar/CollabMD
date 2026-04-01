'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import * as Y from 'yjs'
import { CollabEditor, useYjs, type YjsContext } from '@/components/editor'
import { useSession } from '@/lib/auth-client'
import ShareModal from '@/components/share-modal'

type DocumentPermission = 'owner' | 'editor' | 'commenter' | 'viewer'
type AgentPolicy = 'enabled' | 'restricted' | 'disabled'

function parsePermission(value: unknown): DocumentPermission | null {
  if (value === 'owner' || value === 'editor' || value === 'commenter' || value === 'viewer') {
    return value
  }
  return null
}

function parseAgentPolicy(value: unknown): AgentPolicy {
  if (value === 'enabled' || value === 'restricted' || value === 'disabled') {
    return value
  }
  return 'enabled'
}

function moreRestrictivePermission(
  a: DocumentPermission,
  b: DocumentPermission,
): DocumentPermission {
  const weight: Record<DocumentPermission, number> = {
    owner: 3,
    editor: 2,
    commenter: 1,
    viewer: 0,
  }
  return weight[a] <= weight[b] ? a : b
}

interface DocPageProps {
  params: Promise<{ id: string }>
}

type AwarenessStateShape = {
  user?: {
    id?: string
    name?: string
    color?: string
  }
  source?: string
}

type PresenceAvatar = {
  key: string
  name: string
  color: string
  initial: string
  isAgent: boolean
}

function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function SyncMetadataBadge({
  source,
  lastSynced,
}: {
  source: string | null
  lastSynced: string | null
}) {
  if (!source || source === 'web') return null

  const label = source === 'daemon' ? 'synced from CLI' : `source: ${source}`
  const timeLabel = lastSynced ? formatRelativeTime(lastSynced) : null

  return (
    <span className="ml-2 inline-flex items-center gap-1.5 rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary">
      <svg
        className="h-3 w-3 text-fg-faint"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
        />
      </svg>
      {label}
      {timeLabel && <span className="text-fg-faint">{timeLabel}</span>}
    </span>
  )
}

function SyncNotice({
  source,
  connectionStatus,
  synced,
}: {
  source: string | null
  connectionStatus: 'connected' | 'connecting' | 'disconnected'
  synced: boolean
}) {
  if (connectionStatus === 'disconnected') {
    return (
      <div
        data-testid="sync-notice"
        className="border-b border-accent/20 bg-accent-subtle px-4 py-1.5 font-mono text-[11px] text-fg-secondary"
      >
        reconnecting...
      </div>
    )
  }

  if (source === 'daemon' && connectionStatus === 'connected' && !synced) {
    return (
      <div
        data-testid="sync-notice"
        className="border-b border-border bg-bg-subtle px-4 py-1.5 font-mono text-[11px] text-fg-muted"
      >
        local sync paused, editing in web
      </div>
    )
  }

  return null
}

function PresenceAvatars({ awareness }: { awareness: YjsContext['awareness'] }) {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const onChange = () => setVersion((value) => value + 1)
    awareness.on('change', onChange)
    return () => {
      awareness.off('change', onChange)
    }
  }, [awareness])

  const remotes: PresenceAvatar[] = []
  const seenRemoteUserIds = new Set<string>()

  for (const [clientId, rawState] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue

    const state = rawState as AwarenessStateShape
    const name = state.user?.name?.trim()
    if (!name) continue

    const userId = state.user?.id?.trim()
    if (userId) {
      if (seenRemoteUserIds.has(userId)) continue
      seenRemoteUserIds.add(userId)
    }

    remotes.push({
      key: userId || String(clientId),
      name,
      color: state.user?.color || '#8458B3',
      initial: name.charAt(0).toUpperCase(),
      isAgent: state.source === 'agent' || state.source === 'daemon',
    })
  }

  if (remotes.length === 0) return null

  const visible = remotes.length > 5 ? remotes.slice(0, 4) : remotes.slice(0, 5)
  const overflow = remotes.length > 5 ? remotes.length - 4 : 0

  return (
    <div className="ml-2 flex max-w-[150px] shrink-0 items-center">
      <div className="flex items-center -space-x-1">
        {visible.map((person) => (
          <div
            key={person.key}
            title={person.name}
            aria-label={person.name}
            className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-bg text-[11px] font-mono font-medium text-white"
            style={{ backgroundColor: person.color }}
          >
            <span>{person.initial}</span>
            {person.isAgent && (
              <span className="absolute bottom-0 right-0 inline-flex h-2.5 w-2.5 translate-x-0.5 translate-y-0.5 items-center justify-center rounded-full border border-border bg-bg text-fg">
                <svg
                  viewBox="0 0 16 16"
                  className="h-2 w-2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M5 6.5h6a2 2 0 0 1 2 2v2.5H3V8.5a2 2 0 0 1 2-2Z" />
                  <path d="M6.5 11v1.5M9.5 11v1.5M6.5 4.5h3M8 4.5V3" />
                  <circle cx="6.5" cy="8.75" r=".6" fill="currentColor" stroke="none" />
                  <circle cx="9.5" cy="8.75" r=".6" fill="currentColor" stroke="none" />
                </svg>
              </span>
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div
            title={`${overflow} more`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg text-[11px] font-mono font-medium text-fg-secondary"
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DocPage({ params }: DocPageProps) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const yjs = useYjs(id, {
    user: session?.user
      ? {
          id: session.user.id,
          name: session.user.name ?? session.user.email,
        }
      : undefined,
  })
  const [title, setTitle] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [apiPermission, setApiPermission] = useState<DocumentPermission>('viewer')
  const [agentEditable, setAgentEditable] = useState(true)
  const [orgAgentPolicy, setOrgAgentPolicy] = useState<AgentPolicy>('enabled')
  const [docSource, setDocSource] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(true)
  const [savingTitle, setSavingTitle] = useState(false)
  const [savingAgentEditable, setSavingAgentEditable] = useState(false)
  const [commentStats, setCommentStats] = useState({ comments: 0, suggestions: 0 })
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const queryPermission = parsePermission(searchParams.get('permission'))
  const permission = queryPermission
    ? moreRestrictivePermission(apiPermission, queryPermission)
    : apiPermission
  const canEdit = permission === 'owner' || permission === 'editor'
  const canCommentPermission = canEdit || permission === 'commenter'
  const canView =
    permission === 'owner' ||
    permission === 'editor' ||
    permission === 'commenter' ||
    permission === 'viewer'
  const canComment = Boolean(session?.user.id) && canCommentPermission
  const canResolveComments = Boolean(session?.user.id) && canEdit

  const fetchDoc = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'GET' })
      if (res.ok) {
        const doc = (await res.json()) as {
          title: string
          orgId?: string
          permission?: string
          agentEditable?: boolean
          orgAgentPolicy?: string
          source?: string
          updatedAt?: string
        }
        setNotFound(false)
        setTitle(doc.title)
        setOrgId(typeof doc.orgId === 'string' ? doc.orgId : null)
        setApiPermission(parsePermission(doc.permission) ?? 'viewer')
        setAgentEditable(doc.agentEditable ?? true)
        setOrgAgentPolicy(parseAgentPolicy(doc.orgAgentPolicy))
        setDocSource(typeof doc.source === 'string' ? doc.source : null)
        setLastSynced(typeof doc.updatedAt === 'string' ? doc.updatedAt : null)
      } else if (res.status === 404) {
        setNotFound(true)
      } else {
        setError('Failed to load document.')
      }
    } catch {
      setError('Failed to load document.')
    } finally {
      setLoadingDoc(false)
    }
  }, [id])

  useEffect(() => {
    void fetchDoc()
  }, [fetchDoc])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    const updateCount = () => {
      let suggestions = 0
      for (const value of yjs.ycomments.toArray()) {
        if (!(value instanceof Y.Map)) continue
        if (value.get('suggestion') instanceof Y.Map) {
          suggestions += 1
        }
      }
      setCommentStats({
        comments: yjs.ycomments.length,
        suggestions,
      })
    }

    updateCount()
    yjs.ycomments.observeDeep(updateCount)

    return () => {
      yjs.ycomments.unobserveDeep(updateCount)
    }
  }, [yjs.ycomments])

  const saveTitle = async () => {
    if (savingTitle) return
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === title) {
      setEditing(false)
      return
    }
    setSavingTitle(true)
    setError('')
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) {
        setError('Failed to rename document.')
        return
      }
      setTitle(trimmed)
      window.dispatchEvent(new Event('collabmd:documents-changed'))
    } catch {
      setError('Failed to rename document.')
    } finally {
      setSavingTitle(false)
      setEditing(false)
    }
  }

  const updateAgentEditable = async (next: boolean) => {
    if (savingAgentEditable) return
    const previous = agentEditable
    setSavingAgentEditable(true)
    setAgentEditable(next)
    setError('')
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentEditable: next }),
      })
      if (!res.ok) {
        setAgentEditable(previous)
        setError('Failed to update agent editable setting.')
      }
    } catch {
      setAgentEditable(previous)
      setError('Failed to update agent editable setting.')
    } finally {
      setSavingAgentEditable(false)
    }
  }

  if (loadingDoc && !notFound) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-fg-muted">Loading...</div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="mb-2 font-mono text-lg font-medium text-fg">Document not found</h1>
          <a href="/" className="text-sm text-accent hover:text-accent-hover">
            Back to documents
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        {editing ? (
          <input
            ref={inputRef}
            className="border border-border rounded font-mono text-sm text-fg px-1.5 py-0.5"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveTitle()
              if (e.key === 'Escape') setEditing(false)
            }}
            disabled={savingTitle}
          />
        ) : (
          <button
            onClick={() => {
              setEditValue(title ?? '')
              setEditing(true)
            }}
            className="font-sans text-sm text-fg-secondary hover:text-fg"
          >
            {title ?? id}
          </button>
        )}
        <SyncMetadataBadge source={docSource} lastSynced={lastSynced} />
        <PresenceAvatars awareness={yjs.awareness} />
        <span className="ml-auto flex items-center gap-3">
          {session && permission === 'owner' && orgAgentPolicy === 'restricted' && (
            <label className="flex items-center gap-1.5 font-mono text-xs text-fg-secondary">
              Agent editable
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={agentEditable}
                disabled={savingAgentEditable}
                onChange={(e) => {
                  void updateAgentEditable(e.target.checked)
                }}
              />
            </label>
          )}
          {session && (
            <button
              onClick={() => setShareOpen(true)}
              className="font-mono text-[11px] font-medium py-1 px-[10px] border border-border-strong rounded bg-bg text-fg hover:bg-fg hover:text-bg"
            >
              Share
            </button>
          )}
          {canView && (
            <a
              href={`/doc/${id}/history`}
              className="font-mono text-[11px] font-medium py-1 px-[10px] border border-border rounded bg-bg text-fg-secondary hover:text-fg hover:bg-bg-subtle"
            >
              History
            </a>
          )}
          <span className="inline-flex items-center rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary">
            {commentStats.comments} comment{commentStats.comments === 1 ? '' : 's'}
            {commentStats.suggestions > 0
              ? ` · ${commentStats.suggestions} suggestion${commentStats.suggestions === 1 ? '' : 's'}`
              : ''}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                yjs.synced
                  ? 'bg-green'
                  : yjs.connectionStatus === 'disconnected'
                    ? 'bg-red'
                    : 'bg-accent animate-pulse'
              }`}
            />
            {yjs.synced
              ? 'synced'
              : yjs.connectionStatus === 'disconnected'
                ? 'disconnected'
                : 'connecting'}
          </span>
        </span>
      </header>
      {error && (
        <div className="bg-red-subtle border-b border-red/20 text-red text-xs px-4 py-2">
          {error}
        </div>
      )}
      <SyncNotice source={docSource} connectionStatus={yjs.connectionStatus} synced={yjs.synced} />
      <main className="min-h-0 flex-1">
        <CollabEditor
          yjs={yjs}
          orgId={orgId ?? undefined}
          canEdit={canEdit}
          canComment={canComment}
          canResolveComments={canResolveComments}
          currentUser={
            session
              ? { id: session.user.id, name: session.user.name ?? session.user.email }
              : undefined
          }
        />
      </main>
      <ShareModal docId={id} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}
