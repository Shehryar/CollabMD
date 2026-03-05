'use client'

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { computePopoverPosition } from './comment-popover-position'
import type { PopoverPosition } from './comment-popover-position'

interface CommentInputProps {
  open: boolean
  position: { left: number; top: number } | null
  orgId?: string
  onSubmitComment: (text: string) => void
  onCancel: () => void
}

interface AgentEntry {
  name: string
  description: string
  enabled: boolean
}

interface MentionState {
  start: number
  end: number
  query: string
}

function findMentionAtCursor(value: string, cursor: number): MentionState | null {
  const prefix = value.slice(0, cursor)
  const match = /(^|\s)@([a-zA-Z0-9_-]*)$/.exec(prefix)
  if (!match) return null
  const query = match[2] ?? ''
  const start = cursor - query.length - 1
  return { start, end: cursor, query }
}

export default function CommentInput({
  open,
  position,
  orgId,
  onSubmitComment,
  onCancel,
}: CommentInputProps) {
  const [text, setText] = useState('')
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [mention, setMention] = useState<MentionState | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [popover, setPopover] = useState<PopoverPosition | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setText('')
      setMention(null)
      return
    }

    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      onCancel()
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEscape)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [open, onCancel])

  useEffect(() => {
    if (!orgId) {
      setAgents([])
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/orgs/${orgId}/settings`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { agents?: AgentEntry[] }
        if (cancelled) return
        setAgents(
          Array.isArray(data.agents) ? data.agents.filter((agent) => agent.enabled !== false) : [],
        )
      } catch {
        if (!cancelled) setAgents([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [orgId])

  // Compute clamped position whenever anchor or open state changes
  useLayoutEffect(() => {
    if (!open || !position) {
      setPopover(null)
      return
    }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const measured = rootRef.current?.getBoundingClientRect()
    setPopover(computePopoverPosition(position, viewport, measured?.height))
  }, [open, position])

  // Re-measure after the DOM has rendered content (textarea, buttons, etc.)
  useEffect(() => {
    if (!open || !position || !rootRef.current) return
    const frame = requestAnimationFrame(() => {
      const measured = rootRef.current?.getBoundingClientRect()
      if (!measured) return
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      setPopover(computePopoverPosition(position, viewport, measured.height))
    })
    return () => cancelAnimationFrame(frame)
  }, [open, position, text])

  if (!open || !position || !popover) return null

  const mentionCandidates = mention
    ? agents.filter((agent) => agent.name.toLowerCase().includes(mention.query.toLowerCase()))
    : []

  const applyMention = (name: string) => {
    const input = textareaRef.current
    if (!input || !mention) return
    const before = text.slice(0, mention.start)
    const after = text.slice(mention.end)
    const next = `${before}@${name} ${after}`
    const cursor = before.length + name.length + 2
    setText(next)
    setMention(null)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(cursor, cursor)
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    onSubmitComment(body)
    setText('')
  }

  return (
    <div
      ref={rootRef}
      className="comment-popover fixed z-[60] w-96 rounded border border-border bg-bg p-3 shadow-lg"
      style={{
        left: `${popover.left}px`,
        top: `${popover.top}px`,
      }}
      role="dialog"
      aria-label="Add inline comment"
    >
      {/* Arrow / caret pointing toward the selected text */}
      <div
        className="absolute h-0 w-0"
        style={{
          left: `${popover.arrowLeft}px`,
          ...(popover.flipped
            ? {
                bottom: '-8px',
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderTop: '8px solid var(--border)',
              }
            : {
                top: '-8px',
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderBottom: '8px solid var(--border)',
              }),
          transform: 'translateX(-8px)',
        }}
      />
      {/* Inner arrow (fills the border arrow) */}
      <div
        className="absolute h-0 w-0"
        style={{
          left: `${popover.arrowLeft}px`,
          ...(popover.flipped
            ? {
                bottom: '-7px',
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderTop: '8px solid var(--bg)',
              }
            : {
                top: '-7px',
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderBottom: '8px solid var(--bg)',
              }),
          transform: 'translateX(-8px)',
        }}
      />

      <form onSubmit={submit} className="space-y-2">
        <textarea
          ref={textareaRef}
          rows={4}
          value={text}
          onChange={(event) => {
            const value = event.target.value
            setText(value)
            const cursor = event.target.selectionStart ?? value.length
            const nextMention = findMentionAtCursor(value, cursor)
            setMention(nextMention)
            setMentionIndex(0)
          }}
          onKeyDown={(event) => {
            if (!mention || mentionCandidates.length === 0) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setMentionIndex((value) => (value + 1) % mentionCandidates.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setMentionIndex(
                (value) => (value - 1 + mentionCandidates.length) % mentionCandidates.length,
              )
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const target = mentionCandidates[mentionIndex] ?? mentionCandidates[0]
              if (target) applyMention(target.name)
            }
          }}
          placeholder="Add a comment"
          className="w-full resize-none rounded border border-border bg-bg px-2.5 py-2 font-sans text-[13px] text-fg outline-none focus:border-accent/60"
        />
        {mention && mentionCandidates.length > 0 && (
          <div className="max-h-36 overflow-y-auto rounded border border-border bg-bg">
            {mentionCandidates.map((agent, index) => (
              <button
                key={agent.name}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyMention(agent.name)}
                className={`flex w-full flex-col px-2.5 py-1.5 text-left ${index === mentionIndex ? 'bg-bg-subtle' : 'hover:bg-bg-subtle'}`}
              >
                <span className="font-mono text-[11px] text-fg">@{agent.name}</span>
                {agent.description && (
                  <span className="text-[11px] text-fg-muted">{agent.description}</span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border-strong px-2.5 py-1 font-mono text-[11px] text-fg-secondary hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={text.trim().length === 0}
            className="rounded bg-accent px-2.5 py-1 font-mono text-[11px] text-white disabled:cursor-not-allowed disabled:opacity-55"
          >
            Add comment
          </button>
        </div>
      </form>

      <style>{`
        .comment-popover {
          animation: commentPopoverIn 150ms ease-out;
        }
        @keyframes commentPopoverIn {
          from {
            opacity: 0;
            transform: translateY(${popover.flipped ? '4px' : '-4px'});
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
