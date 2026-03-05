'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language'
import { closeBrackets } from '@codemirror/autocomplete'
import { highlightSelectionMatches } from '@codemirror/search'
import {
  markdownPreviewPlugin,
  markdownPreviewTheme,
  previewEnabled,
} from '@/components/editor/markdown-preview'

type DocumentPermission = 'owner' | 'editor' | 'commenter' | 'viewer'

interface SnapshotItem {
  id: string
  createdAt: string
  createdBy: string | null
  createdByName: string | null
  isAgentEdit: boolean
  label: string | null
}

interface SnapshotDetail extends SnapshotItem {
  content: string
}

interface HistoryPageProps {
  params: Promise<{ id: string }>
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const readonlyEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono), "JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '32px 48px',
    fontFamily: 'var(--font-sans), "Plus Jakarta Sans", system-ui, sans-serif',
    fontSize: '15px',
    lineHeight: '1.7',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: '#999',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#bbb',
  },
  '.cm-activeLine': {
    backgroundColor: '#f7f7f5',
  },
  '.cm-cursor': {
    borderLeftColor: '#111',
    borderLeftWidth: '2px',
  },
})

function parsePermission(value: unknown): DocumentPermission | null {
  if (value === 'owner' || value === 'editor' || value === 'commenter' || value === 'viewer') {
    return value
  }
  return null
}

function formatRelativeTime(timestamp: string): string {
  const diffMs = new Date(timestamp).getTime() - Date.now()
  const absSeconds = Math.abs(diffMs) / 1_000

  if (absSeconds < 60) {
    return relativeTimeFormatter.format(Math.round(diffMs / 1_000), 'second')
  }
  if (absSeconds < 3_600) {
    return relativeTimeFormatter.format(Math.round(diffMs / 60_000), 'minute')
  }
  if (absSeconds < 86_400) {
    return relativeTimeFormatter.format(Math.round(diffMs / 3_600_000), 'hour')
  }
  if (absSeconds < 2_592_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 86_400_000), 'day')
  }
  if (absSeconds < 31_536_000) {
    return relativeTimeFormatter.format(Math.round(diffMs / 2_592_000_000), 'month')
  }
  return relativeTimeFormatter.format(Math.round(diffMs / 31_536_000_000), 'year')
}

function ReadonlyEditor({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const editor = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          readonlyEditorTheme,
          previewEnabled,
          markdownPreviewPlugin,
          markdownPreviewTheme,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
        ],
      }),
      parent: containerRef.current,
    })

    return () => editor.destroy()
  }, [text])

  return <div ref={containerRef} className="h-full min-h-0" />
}

export default function DocHistoryPage({ params }: HistoryPageProps) {
  const { id } = use(params)
  const [title, setTitle] = useState('Document')
  const [permission, setPermission] = useState<DocumentPermission | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [loadingSnapshots, setLoadingSnapshots] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [savingVersion, setSavingVersion] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [error, setError] = useState('')

  const selectedSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null,
    [snapshots, selectedSnapshotId],
  )

  const canEdit = permission === 'owner' || permission === 'editor'

  const loadSnapshots = useCallback(async () => {
    const snapshotsRes = await fetch(`/api/documents/${id}/snapshots?limit=200`, { method: 'GET' })
    if (!snapshotsRes.ok) {
      throw new Error('failed snapshots request')
    }

    const data = (await snapshotsRes.json()) as SnapshotItem[]
    setSnapshots(data)
    setSelectedSnapshotId((current) => current ?? data[0]?.id ?? null)
  }, [id])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setError('')
      setLoadingSnapshots(true)

      try {
        const docRes = await fetch(`/api/documents/${id}`, { method: 'GET' })
        if (!docRes.ok) {
          setError(
            docRes.status === 403
              ? 'You do not have access to this document.'
              : 'Failed to load document.',
          )
          return
        }

        const doc = (await docRes.json()) as { title?: string; permission?: string }
        if (cancelled) return
        setTitle(doc.title ?? 'Document')
        setPermission(parsePermission(doc.permission) ?? 'viewer')

        await loadSnapshots()
      } catch {
        if (!cancelled) {
          setError('Failed to load snapshot history.')
        }
      } finally {
        if (!cancelled) {
          setLoadingSnapshots(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id, loadSnapshots])

  useEffect(() => {
    if (!selectedSnapshotId) {
      setPreviewText('')
      return
    }

    let cancelled = false

    const loadPreview = async () => {
      setLoadingPreview(true)
      setError('')
      try {
        const res = await fetch(`/api/documents/${id}/snapshots/${selectedSnapshotId}`, {
          method: 'GET',
        })
        if (!res.ok) {
          setError('Failed to load snapshot preview.')
          return
        }

        const payload = (await res.json()) as SnapshotDetail
        if (cancelled) return
        setPreviewText(payload.content)
      } catch {
        if (!cancelled) {
          setError('Failed to load snapshot preview.')
        }
      } finally {
        if (!cancelled) {
          setLoadingPreview(false)
        }
      }
    }

    void loadPreview()
    return () => {
      cancelled = true
    }
  }, [id, selectedSnapshotId])

  const saveCurrentVersion = async () => {
    if (!canEdit || savingVersion) return

    const labelInput = window.prompt('Optional label for this version:')
    if (labelInput === null) return

    const label = labelInput.trim() || undefined
    setSavingVersion(true)
    setError('')

    try {
      const res = await fetch(`/api/documents/${id}/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'Failed to save version.' }))
        setError(payload.error ?? 'Failed to save version.')
        return
      }
      await loadSnapshots()
    } catch {
      setError('Failed to save version.')
    } finally {
      setSavingVersion(false)
    }
  }

  const revertToVersion = async () => {
    if (!canEdit || !selectedSnapshot || reverting) return

    const when = new Date(selectedSnapshot.createdAt).toLocaleString()
    const confirmed = window.confirm(
      `Revert to version from ${when}? This replaces the current document content.`,
    )
    if (!confirmed) return

    setReverting(true)
    setError('')

    try {
      const res = await fetch(`/api/documents/${id}/snapshots/${selectedSnapshot.id}/revert`, {
        method: 'POST',
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'Failed to revert snapshot.' }))
        setError(payload.error ?? 'Failed to revert snapshot.')
        return
      }
      window.location.href = `/doc/${id}`
    } catch {
      setError('Failed to revert snapshot.')
    } finally {
      setReverting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h1 className="font-mono text-xs uppercase tracking-[0.08em] text-fg-muted">
          Version history
        </h1>
        <span className="ml-3 truncate font-sans text-sm text-fg-secondary">{title}</span>
      </header>

      {error && (
        <div className="border-b border-red/20 bg-red-subtle px-4 py-2 text-xs text-red">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-border bg-bg-subtle lg:w-[300px] lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Link
              href={`/doc/${id}`}
              className="font-mono text-[11px] px-2 py-1 border border-border rounded bg-bg text-fg hover:bg-bg-subtle"
            >
              Back to editor
            </Link>
            {canEdit && (
              <button
                onClick={() => void saveCurrentVersion()}
                disabled={savingVersion}
                className="font-mono text-[11px] px-2 py-1 border border-border-strong rounded bg-bg text-fg hover:bg-bg-subtle disabled:opacity-50"
              >
                {savingVersion ? 'Saving...' : 'Save current version'}
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto lg:max-h-none lg:h-[calc(100vh-6rem)]">
            {loadingSnapshots && (
              <div className="px-3 py-4 text-xs text-fg-muted">Loading snapshots...</div>
            )}
            {!loadingSnapshots && snapshots.length === 0 && (
              <div className="px-3 py-4 text-xs text-fg-muted">No snapshots yet.</div>
            )}
            {!loadingSnapshots &&
              snapshots.map((snapshot) => {
                const selected = snapshot.id === selectedSnapshotId
                return (
                  <button
                    key={snapshot.id}
                    onClick={() => setSelectedSnapshotId(snapshot.id)}
                    className={`w-full border-b border-border px-3 py-3 text-left ${
                      selected
                        ? 'bg-accent-subtle text-fg'
                        : 'bg-bg-subtle text-fg-secondary hover:bg-bg hover:text-fg'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span>{formatRelativeTime(snapshot.createdAt)}</span>
                      {snapshot.isAgentEdit && (
                        <span className="rounded border border-accent/30 bg-accent-subtle px-1.5 py-0.5 text-[10px] text-accent">
                          agent
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate font-sans text-sm text-fg">
                      {snapshot.createdByName ?? 'Auto-save'}
                    </div>
                    {snapshot.label && (
                      <div className="mt-0.5 truncate text-xs text-accent">{snapshot.label}</div>
                    )}
                  </button>
                )
              })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col bg-bg">
          <div className="min-h-0 flex-1">
            {!selectedSnapshot && !loadingSnapshots && (
              <div className="flex h-full items-center justify-center text-sm text-fg-muted">
                Select a snapshot to preview.
              </div>
            )}
            {selectedSnapshot && loadingPreview && (
              <div className="flex h-full items-center justify-center text-sm text-fg-muted">
                Loading snapshot...
              </div>
            )}
            {selectedSnapshot && !loadingPreview && <ReadonlyEditor text={previewText} />}
          </div>

          {canEdit && selectedSnapshot && (
            <div className="border-t border-border px-4 py-2">
              <button
                onClick={() => void revertToVersion()}
                disabled={reverting}
                className="font-mono text-[11px] px-3 py-1.5 border border-border-strong rounded bg-fg text-bg hover:bg-accent disabled:opacity-50"
              >
                {reverting ? 'Reverting...' : 'Revert to this version'}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
