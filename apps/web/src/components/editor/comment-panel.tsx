'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CommentEntry } from './use-comments'
import type { DiscussionEntry } from './use-discussions'
import { computeCommentLayout } from './comment-layout'
import type { LayoutInput } from './comment-layout'

interface CommentPanelProps {
  comments: CommentEntry[]
  discussions: DiscussionEntry[]
  activeCommentId: string | null
  activeDiscussionId: string | null
  onSelectComment: (commentId: string) => void
  onSelectDiscussion: (discussionId: string) => void
  onReply: (commentId: string, text: string) => void
  onResolve: (commentId: string) => void
  onAcceptSuggestion: (commentId: string) => void
  onDismissSuggestion: (commentId: string) => void
  onCreateDiscussion: (title: string, text: string) => void
  onReplyDiscussion: (discussionId: string, text: string) => void
  onResolveDiscussion: (discussionId: string) => void
  canReply: boolean
  canResolve: boolean
  canEdit: boolean
  open: boolean
  onToggleOpen: () => void
  anchorPositions?: Map<string, number> | null
  editorScrollDOM?: HTMLElement | null
  editorContentHeight?: number
}

function relativeTime(timestamp: string): string {
  const then = Date.parse(timestamp)
  if (!Number.isFinite(then)) return 'just now'

  const diffSeconds = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s ago`

  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks < 5) return `${diffWeeks}w ago`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}mo ago`

  const diffYears = Math.floor(diffDays / 365)
  return `${diffYears}y ago`
}

type AgentMentionStatus = 'pending' | 'responded'

interface AgentMention {
  agentName: string
  status: AgentMentionStatus
}

function getAgentMentions(comment: CommentEntry): AgentMention[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g
  const mentions: AgentMention[] = []
  const seen = new Set<string>()

  for (const match of comment.text.matchAll(mentionRegex)) {
    const name = match[1]?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)

    const hasReply = comment.thread.some(
      (reply) => reply.authorName.toLowerCase() === name.toLowerCase(),
    )

    mentions.push({
      agentName: name,
      status: hasReply ? 'responded' : 'pending',
    })
  }

  return mentions
}

export default function CommentPanel({
  comments,
  discussions,
  activeCommentId,
  activeDiscussionId,
  onSelectComment,
  onSelectDiscussion,
  onReply,
  onResolve,
  onAcceptSuggestion,
  onDismissSuggestion,
  onCreateDiscussion,
  onReplyDiscussion,
  onResolveDiscussion,
  canReply,
  canResolve,
  canEdit,
  open,
  onToggleOpen,
  anchorPositions,
  editorScrollDOM,
  editorContentHeight,
}: CommentPanelProps) {
  const [tab, setTab] = useState<'comments' | 'discussions'>('comments')
  const [showResolved, setShowResolved] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [discussionTitle, setDiscussionTitle] = useState('')
  const [discussionBody, setDiscussionBody] = useState('')
  const [discussionReplyDrafts, setDiscussionReplyDrafts] = useState<Record<string, string>>({})
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({})
  const panelScrollRef = useRef<HTMLDivElement>(null)
  const scrollSyncPausedUntil = useRef(0)

  const useAnchored = !!(anchorPositions && anchorPositions.size > 0 && tab === 'comments')

  // Measure card heights via ResizeObserver
  const observerRef = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    observerRef.current = new ResizeObserver((entries) => {
      const updates: Record<string, number> = {}
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const id = el.dataset.commentId
        if (id) updates[id] = entry.borderBoxSize[0]?.blockSize ?? el.offsetHeight
      }
      if (Object.keys(updates).length > 0) {
        setCardHeights((prev) => ({ ...prev, ...updates }))
      }
    })
    return () => observerRef.current?.disconnect()
  }, [])

  const observeCard = useCallback((id: string, el: HTMLElement | null) => {
    const prev = itemRefs.current[id]
    if (prev && prev !== el && observerRef.current) {
      observerRef.current.unobserve(prev)
    }
    itemRefs.current[id] = el
    if (el && observerRef.current) {
      el.dataset.commentId = id
      observerRef.current.observe(el)
    }
  }, [])

  // Scroll sync: mirror editor scrollTop to panel
  useEffect(() => {
    if (!useAnchored || !editorScrollDOM) return

    const panel = panelScrollRef.current
    if (!panel) return

    const onEditorScroll = () => {
      if (Date.now() < scrollSyncPausedUntil.current) return
      panel.scrollTop = editorScrollDOM.scrollTop
    }

    editorScrollDOM.addEventListener('scroll', onEditorScroll, { passive: true })
    return () => editorScrollDOM.removeEventListener('scroll', onEditorScroll)
  }, [useAnchored, editorScrollDOM])

  // Pause sync when user scrolls panel independently
  useEffect(() => {
    if (!useAnchored) return

    const panel = panelScrollRef.current
    if (!panel) return

    const onPanelScroll = () => {
      scrollSyncPausedUntil.current = Date.now() + 1000
    }

    panel.addEventListener('scroll', onPanelScroll, { passive: true })
    return () => panel.removeEventListener('scroll', onPanelScroll)
  }, [useAnchored])

  useEffect(() => {
    if (!activeCommentId) return
    if (tab !== 'comments') setTab('comments')
    setExpandedIds((previous) => {
      if (previous.has(activeCommentId)) return previous
      const next = new Set(previous)
      next.add(activeCommentId)
      return next
    })

    const target = itemRefs.current[activeCommentId]
    if (target) {
      scrollSyncPausedUntil.current = Date.now() + 500
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [activeCommentId])

  useEffect(() => {
    if (!activeDiscussionId) return
    if (tab !== 'discussions') setTab('discussions')
    setExpandedIds((previous) => {
      if (previous.has(activeDiscussionId)) return previous
      const next = new Set(previous)
      next.add(activeDiscussionId)
      return next
    })

    const target = itemRefs.current[activeDiscussionId]
    if (target) {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [activeDiscussionId, tab])

  useEffect(() => {
    if (!activeCommentId) return
    const active = comments.find((comment) => comment.id === activeCommentId)
    if (active?.resolved) {
      setShowResolved(true)
    }
  }, [activeCommentId, comments])

  const visibleComments = useMemo(() => {
    if (showResolved) return comments
    return comments.filter((comment) => !comment.resolved)
  }, [comments, showResolved])

  // Compute layout positions from anchorPositions + measured card heights
  const layoutMap = useMemo(() => {
    if (!useAnchored || !anchorPositions) return null

    const DEFAULT_HEIGHT = 80
    const inputs: LayoutInput[] = []
    for (const comment of visibleComments) {
      const idealY = anchorPositions.get(comment.id)
      if (idealY == null) continue
      inputs.push({
        id: comment.id,
        idealY,
        height: cardHeights[comment.id] ?? DEFAULT_HEIGHT,
      })
    }

    const outputs = computeCommentLayout(inputs, activeCommentId)
    const map = new Map<string, number>()
    for (const out of outputs) {
      map.set(out.id, out.y)
    }
    return map
  }, [useAnchored, anchorPositions, visibleComments, cardHeights, activeCommentId])

  // Separate anchored comments from orphans (no resolved anchor position)
  const { anchoredComments, orphanComments } = useMemo(() => {
    if (!layoutMap)
      return { anchoredComments: visibleComments, orphanComments: [] as CommentEntry[] }

    const anchored: CommentEntry[] = []
    const orphans: CommentEntry[] = []
    for (const comment of visibleComments) {
      if (layoutMap.has(comment.id)) anchored.push(comment)
      else orphans.push(comment)
    }
    return { anchoredComments: anchored, orphanComments: orphans }
  }, [layoutMap, visibleComments])

  // Compute the max bottom edge for container minHeight
  const anchoredContainerHeight = useMemo(() => {
    if (!layoutMap) return 0
    let maxBottom = 0
    for (const [id, y] of layoutMap) {
      const h = cardHeights[id] ?? 80
      maxBottom = Math.max(maxBottom, y + h)
    }
    return maxBottom + 8
  }, [layoutMap, cardHeights])

  const visibleDiscussions = useMemo(() => {
    const sorted = [...discussions].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
    if (showResolved) return sorted
    return sorted.filter((discussion) => !discussion.resolved)
  }, [discussions, showResolved])

  const unresolvedCount = comments.reduce((total, comment) => total + (comment.resolved ? 0 : 1), 0)
  const unresolvedDiscussionCount = discussions.reduce(
    (total, discussion) => total + (discussion.resolved ? 0 : 1),
    0,
  )

  if (!open) return null

  function renderCommentCard(comment: CommentEntry, anchorY: number | null) {
    const expanded = expandedIds.has(comment.id) || activeCommentId === comment.id
    const replyDraft = replyDrafts[comment.id] ?? ''
    const suggestion = comment.suggestion
    const pendingSuggestion = suggestion?.status === 'pending'
    const acceptedSuggestion = suggestion?.status === 'accepted'
    const dismissedSuggestion = suggestion?.status === 'dismissed'
    const agentMentions = getAgentMentions(comment)

    const isPositioned = anchorY != null

    return (
      <article
        key={comment.id}
        ref={(element) => {
          if (isPositioned) observeCard(comment.id, element)
          else itemRefs.current[comment.id] = element
        }}
        className={`rounded border bg-bg p-2.5 ${
          activeCommentId === comment.id
            ? 'border-accent shadow-sm'
            : 'border-border hover:border-border-strong'
        }`}
        style={
          isPositioned
            ? {
                position: 'absolute',
                top: anchorY,
                left: 0,
                right: 0,
                transition: 'top 150ms ease-out',
              }
            : undefined
        }
      >
        <button
          type="button"
          onClick={() => {
            onSelectComment(comment.id)
            setExpandedIds((previous) => {
              const next = new Set(previous)
              if (next.has(comment.id)) next.delete(comment.id)
              else next.add(comment.id)
              return next
            })
          }}
          className="w-full text-left"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[11px] font-medium text-fg">{comment.authorName}</p>
              <p className="text-[11px] text-fg-muted">{relativeTime(comment.createdAt)}</p>
            </div>
            <div className="flex items-center gap-1">
              {!comment.resolved &&
                agentMentions.map((mention) =>
                  mention.status === 'pending' ? (
                    <span
                      key={`agent-${mention.agentName}`}
                      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                      @{mention.agentName}
                    </span>
                  ) : (
                    <span
                      key={`agent-${mention.agentName}`}
                      className="inline-flex items-center gap-1 rounded border border-green/20 bg-green-subtle px-1.5 py-0.5 font-mono text-[10px] text-green"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      @{mention.agentName}
                    </span>
                  ),
                )}
              {suggestion && (
                <span className="rounded border border-[#f59e0b]/30 bg-[#fffbeb] px-1.5 py-0.5 font-mono text-[10px] text-[#b45309]">
                  Suggestion
                </span>
              )}
              {acceptedSuggestion && (
                <span className="rounded border border-green/20 bg-green-subtle px-1.5 py-0.5 font-mono text-[10px] text-green">
                  Accepted
                </span>
              )}
              {dismissedSuggestion && (
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                  Dismissed
                </span>
              )}
              {comment.resolved && !suggestion && (
                <span className="rounded border border-green/20 bg-green-subtle px-1.5 py-0.5 font-mono text-[10px] text-green">
                  Resolved
                </span>
              )}
              {comment.thread.length > 0 && (
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                  {comment.thread.length} repl{comment.thread.length === 1 ? 'y' : 'ies'}
                </span>
              )}
            </div>
          </div>
          {suggestion ? (
            <div className="mt-2 space-y-2">
              <div className="rounded border border-red/20 bg-red-subtle px-2 py-1 text-[12px] text-red">
                <span className="font-mono text-[10px] uppercase tracking-wide opacity-75">
                  Original
                </span>
                <p className="mt-1 whitespace-pre-wrap line-through">{suggestion.originalText}</p>
              </div>
              <div className="rounded border border-green/20 bg-green-subtle px-2 py-1 text-[12px] text-green">
                <span className="font-mono text-[10px] uppercase tracking-wide opacity-75">
                  Proposed
                </span>
                <p className="mt-1 whitespace-pre-wrap">{suggestion.proposedText}</p>
              </div>
              {comment.text && comment.text !== 'Suggested edit' && (
                <p className="whitespace-pre-wrap text-[12px] text-fg-secondary">{comment.text}</p>
              )}
            </div>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[13px] text-fg-secondary">{comment.text}</p>
          )}
        </button>

        {expanded && (
          <div className="mt-2 space-y-2 border-t border-border pt-2">
            {comment.thread.map((entry: CommentEntry['thread'][number], index: number) => (
              <div
                key={`${comment.id}-${index}`}
                className="rounded border border-border bg-bg-subtle px-2 py-1.5"
              >
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] text-fg">{entry.authorName}</p>
                  <p className="text-[10px] text-fg-muted">{relativeTime(entry.createdAt)}</p>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[12px] text-fg-secondary">
                  {entry.text}
                </p>
              </div>
            ))}

            <div className="flex items-center justify-end gap-2">
              {canEdit && pendingSuggestion && (
                <>
                  <button
                    type="button"
                    onClick={() => onDismissSuggestion(comment.id)}
                    className="rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary hover:bg-bg-subtle"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => onAcceptSuggestion(comment.id)}
                    className="rounded border border-green bg-green px-2 py-1 font-mono text-[10px] text-bg hover:opacity-90"
                  >
                    Accept
                  </button>
                </>
              )}
              {canResolve && !comment.resolved && (
                <button
                  type="button"
                  onClick={() => onResolve(comment.id)}
                  className="rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary hover:bg-bg-subtle"
                >
                  Resolve
                </button>
              )}
            </div>

            {canReply && !comment.resolved && (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const next = replyDraft.trim()
                  if (!next) return
                  onReply(comment.id, next)
                  setReplyDrafts((previous) => ({ ...previous, [comment.id]: '' }))
                }}
                className="space-y-1.5"
              >
                <textarea
                  value={replyDraft}
                  onChange={(event) =>
                    setReplyDrafts((previous) => ({
                      ...previous,
                      [comment.id]: event.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Reply"
                  className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg outline-none focus:border-accent"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={replyDraft.trim().length === 0}
                    className="rounded border border-accent bg-accent px-2 py-1 font-mono text-[10px] text-accent-text disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    Reply
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-bg-subtle">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div>
          <h2 className="font-mono text-[12px] font-semibold text-fg">
            {tab === 'comments' ? 'Comments' : 'Discussions'}
          </h2>
          <p className="text-[11px] text-fg-muted">
            {tab === 'comments' ? unresolvedCount : unresolvedDiscussionCount} open
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          className="rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary hover:bg-bg"
        >
          Hide
        </button>
      </div>
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setTab('comments')}
          className={`rounded px-2 py-1 font-mono text-[10px] ${tab === 'comments' ? 'bg-bg text-fg border border-border' : 'text-fg-secondary hover:bg-bg'}`}
        >
          Comments ({comments.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('discussions')}
          className={`rounded px-2 py-1 font-mono text-[10px] ${tab === 'discussions' ? 'bg-bg text-fg border border-border' : 'text-fg-secondary hover:bg-bg'}`}
        >
          Discussions ({discussions.length})
        </button>
      </div>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-fg-secondary">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
            className="h-3.5 w-3.5"
          />
          Show resolved
        </label>
        <span className="font-mono text-[10px] text-fg-muted">
          {tab === 'comments' ? comments.length : discussions.length} total
        </span>
      </div>
      <div ref={panelScrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'comments' ? (
          <>
            {visibleComments.length === 0 && (
              <div className="rounded border border-dashed border-border px-3 py-2.5 text-[12px] text-fg-muted">
                No comments in this view.
              </div>
            )}
            {useAnchored && layoutMap ? (
              <div
                className="relative"
                style={{ minHeight: Math.max(anchoredContainerHeight, editorContentHeight ?? 0) }}
              >
                {anchoredComments.map((comment) => {
                  const y = layoutMap.get(comment.id) ?? 0
                  return renderCommentCard(comment, y)
                })}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleComments.map((comment) => renderCommentCard(comment, null))}
              </div>
            )}
            {useAnchored && orphanComments.length > 0 && (
              <div className="mt-4 border-t border-border pt-2">
                <p className="mb-2 font-mono text-[10px] text-fg-muted">Unanchored comments</p>
                <div className="space-y-2">
                  {orphanComments.map((comment) => renderCommentCard(comment, null))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {canReply && (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const title = discussionTitle.trim()
                  const text = discussionBody.trim()
                  if (!title || !text) return
                  onCreateDiscussion(title, text)
                  setDiscussionTitle('')
                  setDiscussionBody('')
                }}
                className="mb-2 space-y-1.5 rounded border border-border bg-bg p-2"
              >
                <input
                  value={discussionTitle}
                  onChange={(event) => setDiscussionTitle(event.target.value)}
                  placeholder="Discussion title"
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
                />
                <textarea
                  value={discussionBody}
                  onChange={(event) => setDiscussionBody(event.target.value)}
                  rows={2}
                  placeholder="Start a document-level discussion"
                  className="w-full resize-none rounded border border-border bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={
                      discussionTitle.trim().length === 0 || discussionBody.trim().length === 0
                    }
                    className="rounded border border-accent bg-accent px-2 py-1 font-mono text-[10px] text-accent-text disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    New thread
                  </button>
                </div>
              </form>
            )}

            {visibleDiscussions.length === 0 && (
              <div className="rounded border border-dashed border-border px-3 py-2.5 text-[12px] text-fg-muted">
                No discussions in this view.
              </div>
            )}

            <div className="space-y-2">
              {visibleDiscussions.map((discussion) => {
                const expanded =
                  expandedIds.has(discussion.id) || activeDiscussionId === discussion.id
                const replyDraft = discussionReplyDrafts[discussion.id] ?? ''
                return (
                  <article
                    key={discussion.id}
                    ref={(element) => {
                      itemRefs.current[discussion.id] = element
                    }}
                    className={`rounded border bg-bg p-2.5 ${activeDiscussionId === discussion.id ? 'border-accent shadow-sm' : 'border-border hover:border-border-strong'}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectDiscussion(discussion.id)
                        setExpandedIds((previous) => {
                          const next = new Set(previous)
                          if (next.has(discussion.id)) next.delete(discussion.id)
                          else next.add(discussion.id)
                          return next
                        })
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono text-[11px] font-medium text-fg">
                            {discussion.title}
                          </p>
                          <p className="text-[11px] text-fg-muted">
                            {discussion.author.name || discussion.author.userId} ·{' '}
                            {relativeTime(discussion.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {discussion.resolved && (
                            <span className="rounded border border-green/20 bg-green-subtle px-1.5 py-0.5 font-mono text-[10px] text-green">
                              Resolved
                            </span>
                          )}
                          {discussion.thread.length > 0 && (
                            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                              {discussion.thread.length} repl
                              {discussion.thread.length === 1 ? 'y' : 'ies'}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] text-fg-secondary">
                        {discussion.text}
                      </p>
                    </button>

                    {expanded && (
                      <div className="mt-2 space-y-2 border-t border-border pt-2">
                        {discussion.thread.map((entry, index) => (
                          <div
                            key={`${discussion.id}-${index}`}
                            className="rounded border border-border bg-bg-subtle px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <p className="font-mono text-[10px] text-fg">
                                {entry.author.name || entry.author.userId}
                              </p>
                              <p className="text-[10px] text-fg-muted">
                                {relativeTime(entry.createdAt)}
                              </p>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-[12px] text-fg-secondary">
                              {entry.text}
                            </p>
                          </div>
                        ))}

                        {!discussion.resolved && (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault()
                              const next = replyDraft.trim()
                              if (!next) return
                              onReplyDiscussion(discussion.id, next)
                              setDiscussionReplyDrafts((previous) => ({
                                ...previous,
                                [discussion.id]: '',
                              }))
                            }}
                            className="space-y-1.5"
                          >
                            <textarea
                              value={replyDraft}
                              onChange={(event) =>
                                setDiscussionReplyDrafts((previous) => ({
                                  ...previous,
                                  [discussion.id]: event.target.value,
                                }))
                              }
                              rows={2}
                              placeholder="Reply"
                              className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-[12px] text-fg outline-none focus:border-accent"
                            />
                            <div className="flex items-center justify-end gap-2">
                              {canResolve && (
                                <button
                                  type="button"
                                  onClick={() => onResolveDiscussion(discussion.id)}
                                  className="rounded border border-border px-2 py-1 font-mono text-[10px] text-fg-secondary hover:bg-bg-subtle"
                                >
                                  Resolve
                                </button>
                              )}
                              <button
                                type="submit"
                                disabled={replyDraft.trim().length === 0}
                                className="rounded border border-accent bg-accent px-2 py-1 font-mono text-[10px] text-accent-text disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                Reply
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
