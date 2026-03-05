'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'

const COMMENT_SYNC_DEBOUNCE_MS = 40

export type CommentSource = 'browser' | 'daemon'

export interface CommentThreadEntry {
  authorId: string
  authorName: string
  text: string
  createdAt: string
}

export interface SuggestionData {
  originalText: string
  proposedText: string
  status: 'pending' | 'accepted' | 'dismissed'
}

export interface CommentEntry {
  id: string
  anchorStart: Uint8Array
  anchorEnd: Uint8Array
  authorId: string
  authorName: string
  source: CommentSource
  text: string
  createdAt: string
  resolved: boolean
  thread: CommentThreadEntry[]
  suggestion?: SuggestionData
}

export type InlineComment = CommentEntry

export interface CommentRange {
  from: number
  to: number
}

interface CreateCommentInput {
  ydoc: Y.Doc
  ytext: Y.Text
  ycomments: Y.Array<Y.Map<unknown>>
  from: number
  to: number
  authorId: string
  authorName: string
  text: string
  source?: CommentSource
  createdAt?: string
}

interface CreateSuggestionInput extends CreateCommentInput {
  originalText: string
  proposedText: string
}

interface ReplyCommentInput {
  ydoc: Y.Doc
  ycomments: Y.Array<Y.Map<unknown>>
  commentId: string
  authorId: string
  authorName: string
  text: string
  createdAt?: string
}

interface ResolveCommentInput {
  ydoc: Y.Doc
  ycomments: Y.Array<Y.Map<unknown>>
  commentId: string
  resolved: boolean
}

interface AcceptSuggestionInput {
  ydoc: Y.Doc
  ytext: Y.Text
  ycomments: Y.Array<Y.Map<unknown>>
  commentId: string
}

interface DismissSuggestionInput {
  ydoc: Y.Doc
  ycomments: Y.Array<Y.Map<unknown>>
  commentId: string
}

interface UseCommentsOptions {
  ydoc: Y.Doc
  ytext: Y.Text
  ycomments: Y.Array<Y.Map<unknown>>
  currentUser?: {
    id: string
    name?: string | null
  } | null
  canComment?: boolean
  canResolve?: boolean
  canEdit?: boolean
}

interface CreateCommentOptions {
  from: number
  to: number
  text: string
  source?: CommentSource
  authorId?: string
  authorName?: string
}

interface CreateSuggestionOptions extends CreateCommentOptions {
  originalText: string
  proposedText: string
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readThread(thread: unknown): CommentThreadEntry[] {
  if (!(thread instanceof Y.Array)) return []

  const entries: CommentThreadEntry[] = []
  for (const value of thread.toArray()) {
    if (!(value instanceof Y.Map)) continue

    const text = asString(value.get('text')).trim()
    if (!text) continue

    entries.push({
      authorId: asString(value.get('authorId')),
      authorName: asString(value.get('authorName')),
      text,
      createdAt: asString(value.get('createdAt')),
    })
  }

  return entries
}

function readSuggestion(suggestion: unknown): SuggestionData | undefined {
  if (!(suggestion instanceof Y.Map)) return undefined

  const originalText = asString(suggestion.get('originalText'))
  const proposedText = asString(suggestion.get('proposedText'))
  const rawStatus = suggestion.get('status')
  const status = rawStatus === 'accepted' || rawStatus === 'dismissed' ? rawStatus : 'pending'

  return {
    originalText,
    proposedText,
    status,
  }
}

function readComment(value: unknown): CommentEntry | null {
  if (!(value instanceof Y.Map)) return null

  const id = asString(value.get('id')).trim()
  const anchorStart = value.get('anchorStart')
  const anchorEnd = value.get('anchorEnd')
  const text = asString(value.get('text')).trim()

  if (!id || !(anchorStart instanceof Uint8Array) || !(anchorEnd instanceof Uint8Array) || !text) {
    return null
  }

  const source = value.get('source')

  return {
    id,
    anchorStart,
    anchorEnd,
    authorId: asString(value.get('authorId')),
    authorName: asString(value.get('authorName')),
    source: source === 'daemon' ? 'daemon' : 'browser',
    text,
    createdAt: asString(value.get('createdAt')),
    resolved: asBool(value.get('resolved')),
    thread: readThread(value.get('thread')),
    suggestion: readSuggestion(value.get('suggestion')),
  }
}

function findCommentMap(
  ycomments: Y.Array<Y.Map<unknown>>,
  commentId: string,
): Y.Map<unknown> | null {
  for (const value of ycomments.toArray()) {
    if (!(value instanceof Y.Map)) continue
    if (value.get('id') === commentId) return value
  }
  return null
}

function readComments(ycomments: Y.Array<Y.Map<unknown>>): CommentEntry[] {
  const parsed: CommentEntry[] = []

  for (const value of ycomments.toArray()) {
    const comment = readComment(value)
    if (comment) parsed.push(comment)
  }

  parsed.sort((a, b) => {
    const left = Date.parse(a.createdAt)
    const right = Date.parse(b.createdAt)
    if (Number.isNaN(left) || Number.isNaN(right)) return 0
    return left - right
  })

  return parsed
}

export function listInlineComments(ycomments: Y.Array<Y.Map<unknown>>): CommentEntry[] {
  return readComments(ycomments)
}

export function toAbsoluteCommentRange(
  ydoc: Y.Doc,
  ytext: Y.Text,
  anchorStart: Uint8Array,
  anchorEnd: Uint8Array,
): CommentRange | null {
  try {
    const startRel = Y.decodeRelativePosition(anchorStart)
    const endRel = Y.decodeRelativePosition(anchorEnd)
    const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, ydoc)
    const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, ydoc)

    if (!startAbs || !endAbs || startAbs.type !== ytext || endAbs.type !== ytext) {
      return null
    }

    let from = Math.min(startAbs.index, endAbs.index)
    let to = Math.max(startAbs.index, endAbs.index)

    from = Math.max(0, Math.min(from, ytext.length))
    to = Math.max(0, Math.min(to, ytext.length))

    return { from, to }
  } catch {
    return null
  }
}

export function getCommentAbsoluteRangeById(
  ydoc: Y.Doc,
  ytext: Y.Text,
  ycomments: Y.Array<Y.Map<unknown>>,
  input: { commentId: string },
): CommentRange | null {
  const comment = findCommentMap(ycomments, input.commentId)
  if (!comment) return null

  const anchorStart = comment.get('anchorStart')
  const anchorEnd = comment.get('anchorEnd')

  if (!(anchorStart instanceof Uint8Array) || !(anchorEnd instanceof Uint8Array)) {
    return null
  }

  return toAbsoluteCommentRange(ydoc, ytext, anchorStart, anchorEnd)
}

export function createCommentInYArray(input: CreateCommentInput): string | null {
  const text = input.text.trim()
  if (!text) return null

  const from = Math.max(0, Math.min(input.from, input.to))
  const to = Math.max(0, Math.max(input.from, input.to))
  if (from === to) return null

  const startAnchor = Y.encodeRelativePosition(
    Y.createRelativePositionFromTypeIndex(input.ytext, from),
  )
  const endAnchor = Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(input.ytext, to))

  const id = createId()
  const createdAt = input.createdAt ?? new Date().toISOString()

  input.ydoc.transact(() => {
    const ycomment = new Y.Map<unknown>()
    ycomment.set('id', id)
    ycomment.set('anchorStart', startAnchor)
    ycomment.set('anchorEnd', endAnchor)
    ycomment.set('authorId', input.authorId)
    ycomment.set('authorName', input.authorName)
    ycomment.set('source', input.source ?? 'browser')
    ycomment.set('text', text)
    ycomment.set('createdAt', createdAt)
    ycomment.set('resolved', false)
    ycomment.set('thread', new Y.Array<Y.Map<unknown>>())

    input.ycomments.push([ycomment])
  }, 'comment-create')

  return id
}

export function createSuggestionInYArray(input: CreateSuggestionInput): string | null {
  const commentId = createCommentInYArray(input)
  if (!commentId) return null

  const comment = findCommentMap(input.ycomments, commentId)
  if (!comment) return null

  input.ydoc.transact(() => {
    const suggestion = new Y.Map<unknown>()
    suggestion.set('originalText', input.originalText)
    suggestion.set('proposedText', input.proposedText)
    suggestion.set('status', 'pending')
    comment.set('suggestion', suggestion)
  }, 'comment-create')

  return commentId
}

export function createInlineComment(
  ydoc: Y.Doc,
  ytext: Y.Text,
  ycomments: Y.Array<Y.Map<unknown>>,
  input: {
    from: number
    to: number
    authorId: string
    authorName: string
    text: string
    source?: CommentSource
    createdAt?: string
  },
): string | null {
  return createCommentInYArray({
    ydoc,
    ytext,
    ycomments,
    ...input,
  })
}

export function acceptSuggestionInYArray(input: AcceptSuggestionInput): boolean {
  const comment = findCommentMap(input.ycomments, input.commentId)
  if (!comment) return false

  const suggestion = comment.get('suggestion')
  if (!(suggestion instanceof Y.Map)) return false

  const status = suggestion.get('status')
  if (status === 'accepted') return true
  if (status === 'dismissed') return false

  const proposedText = asString(suggestion.get('proposedText'))
  const anchorStart = comment.get('anchorStart')
  const anchorEnd = comment.get('anchorEnd')

  if (!(anchorStart instanceof Uint8Array) || !(anchorEnd instanceof Uint8Array)) {
    return false
  }

  const range = toAbsoluteCommentRange(input.ydoc, input.ytext, anchorStart, anchorEnd)
  if (!range) return false

  input.ydoc.transact(() => {
    input.ytext.delete(range.from, range.to - range.from)
    if (proposedText.length > 0) {
      input.ytext.insert(range.from, proposedText)
    }
    suggestion.set('status', 'accepted')
    comment.set('resolved', true)
  }, 'suggestion-accept')

  return true
}

export function dismissSuggestionInYArray(input: DismissSuggestionInput): boolean {
  const comment = findCommentMap(input.ycomments, input.commentId)
  if (!comment) return false

  const suggestion = comment.get('suggestion')
  if (!(suggestion instanceof Y.Map)) return false

  const status = suggestion.get('status')
  if (status === 'accepted') return false
  if (status === 'dismissed') return true

  input.ydoc.transact(() => {
    suggestion.set('status', 'dismissed')
    comment.set('resolved', true)
  }, 'suggestion-dismiss')

  return true
}

export function replyToCommentInYArray(input: ReplyCommentInput): boolean {
  const text = input.text.trim()
  if (!text) return false

  const comment = findCommentMap(input.ycomments, input.commentId)
  if (!comment) return false

  const createdAt = input.createdAt ?? new Date().toISOString()

  input.ydoc.transact(() => {
    const reply = new Y.Map<unknown>()
    reply.set('authorId', input.authorId)
    reply.set('authorName', input.authorName)
    reply.set('text', text)
    reply.set('createdAt', createdAt)

    const thread = comment.get('thread')
    if (thread instanceof Y.Array) {
      thread.push([reply])
      return
    }

    const nextThread = new Y.Array<Y.Map<unknown>>()
    nextThread.push([reply])
    comment.set('thread', nextThread)
  }, 'comment-reply')

  return true
}

export function addCommentReply(
  ydoc: Y.Doc,
  ycomments: Y.Array<Y.Map<unknown>>,
  input: {
    commentId: string
    authorId: string
    authorName: string
    text: string
    createdAt?: string
  },
): boolean {
  return replyToCommentInYArray({
    ydoc,
    ycomments,
    ...input,
  })
}

export function setCommentResolvedInYArray(input: ResolveCommentInput): boolean {
  const comment = findCommentMap(input.ycomments, input.commentId)
  if (!comment) return false

  input.ydoc.transact(() => {
    comment.set('resolved', input.resolved)
  }, 'comment-resolve')

  return true
}

export function setCommentResolved(
  ydoc: Y.Doc,
  ycomments: Y.Array<Y.Map<unknown>>,
  input: {
    commentId: string
    resolved?: boolean
  },
): boolean {
  return setCommentResolvedInYArray({
    ydoc,
    ycomments,
    commentId: input.commentId,
    resolved: input.resolved ?? true,
  })
}

export function useComments(options: UseCommentsOptions) {
  const {
    ydoc,
    ytext,
    ycomments,
    currentUser,
    canComment = false,
    canResolve = false,
    canEdit = false,
  } = options

  const [comments, setComments] = useState<CommentEntry[]>(() => readComments(ycomments))
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const syncComments = () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }
      setComments(readComments(ycomments))
    }

    const scheduleSync = () => {
      if (syncTimerRef.current) return
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null
        setComments(readComments(ycomments))
      }, COMMENT_SYNC_DEBOUNCE_MS)
    }

    syncComments()
    ycomments.observeDeep(scheduleSync)

    return () => {
      ycomments.unobserveDeep(scheduleSync)
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }
    }
  }, [ycomments])

  const commentsById = useMemo(() => {
    const map = new Map<string, CommentEntry>()
    for (const comment of comments) {
      map.set(comment.id, comment)
    }
    return map
  }, [comments])

  const createComment = useCallback(
    (input: CreateCommentOptions): string | null => {
      if (!canComment) return null

      const authorId = currentUser?.id ?? input.authorId
      if (!authorId) return null

      const authorName = currentUser?.name?.trim() || input.authorName?.trim() || 'Unknown user'

      return createCommentInYArray({
        ydoc,
        ytext,
        ycomments,
        from: input.from,
        to: input.to,
        text: input.text,
        authorId,
        authorName,
        source: input.source ?? 'browser',
      })
    },
    [canComment, currentUser?.id, currentUser?.name, ycomments, ydoc, ytext],
  )

  const createSuggestion = useCallback(
    (input: CreateSuggestionOptions): string | null => {
      if (!canComment) return null

      const authorId = currentUser?.id ?? input.authorId
      if (!authorId) return null

      const authorName = currentUser?.name?.trim() || input.authorName?.trim() || 'Unknown user'

      return createSuggestionInYArray({
        ydoc,
        ytext,
        ycomments,
        from: input.from,
        to: input.to,
        text: input.text,
        originalText: input.originalText,
        proposedText: input.proposedText,
        authorId,
        authorName,
        source: input.source ?? 'browser',
      })
    },
    [canComment, currentUser?.id, currentUser?.name, ycomments, ydoc, ytext],
  )

  const replyToComment = useCallback(
    (commentId: string, text: string): boolean => {
      if (!canComment) return false

      const authorId = currentUser?.id
      if (!authorId) return false

      return replyToCommentInYArray({
        ydoc,
        ycomments,
        commentId,
        text,
        authorId,
        authorName: currentUser.name?.trim() || 'Unknown user',
      })
    },
    [canComment, currentUser?.id, currentUser?.name, ycomments, ydoc],
  )

  const setResolved = useCallback(
    (commentId: string, resolved: boolean): boolean => {
      if (!canResolve) return false

      return setCommentResolvedInYArray({
        ydoc,
        ycomments,
        commentId,
        resolved,
      })
    },
    [canResolve, ycomments, ydoc],
  )

  const acceptSuggestion = useCallback(
    (commentId: string): boolean => {
      if (!canEdit) return false

      return acceptSuggestionInYArray({
        ydoc,
        ytext,
        ycomments,
        commentId,
      })
    },
    [canEdit, ycomments, ydoc, ytext],
  )

  const dismissSuggestion = useCallback(
    (commentId: string): boolean => {
      if (!canEdit) return false

      return dismissSuggestionInYArray({
        ydoc,
        ycomments,
        commentId,
      })
    },
    [canEdit, ycomments, ydoc],
  )

  const getAbsoluteRange = useCallback(
    (commentId: string): CommentRange | null => {
      const comment = commentsById.get(commentId)
      if (!comment) return null

      return toAbsoluteCommentRange(ydoc, ytext, comment.anchorStart, comment.anchorEnd)
    },
    [commentsById, ydoc, ytext],
  )

  const resolveComment = useCallback(
    ({ commentId, resolved = true }: { commentId: string; resolved?: boolean }) => {
      return setResolved(commentId, resolved)
    },
    [setResolved],
  )

  const getCommentRange = useCallback(
    ({ commentId }: { commentId: string }) => {
      return getAbsoluteRange(commentId)
    },
    [getAbsoluteRange],
  )

  return {
    comments,
    createComment,
    createSuggestion,
    replyToComment,
    setResolved,
    acceptSuggestion,
    dismissSuggestion,
    getAbsoluteRange,
    resolveComment,
    getCommentRange,
  }
}

export type UseCommentsResult = ReturnType<typeof useComments>
