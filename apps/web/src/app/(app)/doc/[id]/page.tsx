'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import * as Y from 'yjs'
import { CollabEditor, useYjs } from '@/components/editor'
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

function moreRestrictivePermission(a: DocumentPermission, b: DocumentPermission): DocumentPermission {
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

export default function DocPage({ params }: DocPageProps) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const yjs = useYjs(id)
  const { data: session } = useSession()
  const [title, setTitle] = useState<string | null>(null)
  const [apiPermission, setApiPermission] = useState<DocumentPermission>('viewer')
  const [agentEditable, setAgentEditable] = useState(true)
  const [orgAgentPolicy, setOrgAgentPolicy] = useState<AgentPolicy>('enabled')
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
  const canComment = Boolean(session?.user.id) && canCommentPermission
  const canResolveComments = Boolean(session?.user.id) && canEdit

  const fetchDoc = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'GET' })
      if (res.ok) {
        const doc = await res.json() as {
          title: string
          permission?: string
          agentEditable?: boolean
          orgAgentPolicy?: string
        }
        setNotFound(false)
        setTitle(doc.title)
        setApiPermission(parsePermission(doc.permission) ?? 'viewer')
        setAgentEditable(doc.agentEditable ?? true)
        setOrgAgentPolicy(parseAgentPolicy(doc.orgAgentPolicy))
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
          <span className="inline-flex items-center rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary">
            {commentStats.comments} comment{commentStats.comments === 1 ? '' : 's'}
            {commentStats.suggestions > 0
              ? ` · ${commentStats.suggestions} suggestion${commentStats.suggestions === 1 ? '' : 's'}`
              : ''}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${yjs.synced ? 'bg-green' : 'bg-accent animate-pulse'}`}
            />
            {yjs.synced ? 'synced' : 'connecting'}
          </span>
        </span>
      </header>
      {error && <div className="bg-red-subtle border-b border-red/20 text-red text-xs px-4 py-2">{error}</div>}
      <main className="min-h-0 flex-1">
        <CollabEditor
          yjs={yjs}
          canEdit={canEdit}
          canComment={canComment}
          canResolveComments={canResolveComments}
          currentUser={session ? { id: session.user.id, name: session.user.name ?? session.user.email } : undefined}
        />
      </main>
      <ShareModal docId={id} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}
