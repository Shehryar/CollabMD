'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'

const DISCUSSION_SYNC_DEBOUNCE_MS = 40

export interface DiscussionAuthor {
  userId: string
  name: string
}

export interface DiscussionReply {
  author: DiscussionAuthor
  text: string
  createdAt: string
}

export interface DiscussionEntry {
  id: string
  author: DiscussionAuthor
  title: string
  text: string
  createdAt: string
  resolved: boolean
  thread: DiscussionReply[]
}

interface UseDiscussionsOptions {
  ydoc: Y.Doc
  ydiscussions: Y.Array<Y.Map<unknown>>
  currentUser?: {
    id: string
    name?: string | null
  } | null
  canComment?: boolean
  canResolve?: boolean
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readAuthor(value: unknown): DiscussionAuthor {
  if (!(value instanceof Y.Map)) {
    return { userId: '', name: '' }
  }
  return {
    userId: asString(value.get('userId')),
    name: asString(value.get('name')),
  }
}

function createAuthor(userId: string, name: string): Y.Map<unknown> {
  const author = new Y.Map<unknown>()
  author.set('userId', userId)
  author.set('name', name)
  return author
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readDiscussions(ydiscussions: Y.Array<Y.Map<unknown>>): DiscussionEntry[] {
  const discussions: DiscussionEntry[] = []
  for (const value of ydiscussions.toArray()) {
    if (!(value instanceof Y.Map)) continue

    const id = asString(value.get('id')).trim()
    const title = asString(value.get('title')).trim()
    const text = asString(value.get('text')).trim()
    if (!id || !title || !text) continue

    const threadValue = value.get('thread')
    const thread: DiscussionReply[] = []
    if (threadValue instanceof Y.Array) {
      for (const entry of threadValue.toArray()) {
        if (!(entry instanceof Y.Map)) continue
        const replyText = asString(entry.get('text')).trim()
        if (!replyText) continue
        thread.push({
          author: readAuthor(entry.get('author')),
          text: replyText,
          createdAt: asString(entry.get('createdAt')),
        })
      }
    }

    discussions.push({
      id,
      author: readAuthor(value.get('author')),
      title,
      text,
      createdAt: asString(value.get('createdAt')),
      resolved: value.get('resolved') === true,
      thread,
    })
  }

  discussions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return discussions
}

function findDiscussion(
  ydiscussions: Y.Array<Y.Map<unknown>>,
  discussionId: string,
): Y.Map<unknown> | null {
  for (const value of ydiscussions.toArray()) {
    if (!(value instanceof Y.Map)) continue
    if (value.get('id') === discussionId) return value
  }
  return null
}

export function createDiscussionInYArray(input: {
  ydoc: Y.Doc
  ydiscussions: Y.Array<Y.Map<unknown>>
  authorId: string
  authorName: string
  title: string
  text: string
  createdAt?: string
}): string | null {
  const title = input.title.trim()
  const text = input.text.trim()
  if (!title || !text) return null

  const id = createId()
  input.ydoc.transact(() => {
    const discussion = new Y.Map<unknown>()
    discussion.set('id', id)
    discussion.set('author', createAuthor(input.authorId, input.authorName))
    discussion.set('title', title)
    discussion.set('text', text)
    discussion.set('createdAt', input.createdAt ?? new Date().toISOString())
    discussion.set('resolved', false)
    discussion.set('thread', new Y.Array<Y.Map<unknown>>())
    input.ydiscussions.push([discussion])
  }, 'discussion-create')

  return id
}

export function replyToDiscussionInYArray(input: {
  ydoc: Y.Doc
  ydiscussions: Y.Array<Y.Map<unknown>>
  discussionId: string
  authorId: string
  authorName: string
  text: string
  createdAt?: string
}): boolean {
  const discussion = findDiscussion(input.ydiscussions, input.discussionId)
  const text = input.text.trim()
  if (!discussion || !text) return false

  input.ydoc.transact(() => {
    const reply = new Y.Map<unknown>()
    reply.set('author', createAuthor(input.authorId, input.authorName))
    reply.set('text', text)
    reply.set('createdAt', input.createdAt ?? new Date().toISOString())

    const existing = discussion.get('thread')
    if (existing instanceof Y.Array) {
      existing.push([reply])
      return
    }
    const thread = new Y.Array<Y.Map<unknown>>()
    thread.push([reply])
    discussion.set('thread', thread)
  }, 'discussion-reply')

  return true
}

export function setDiscussionResolvedInYArray(input: {
  ydoc: Y.Doc
  ydiscussions: Y.Array<Y.Map<unknown>>
  discussionId: string
  resolved: boolean
}): boolean {
  const discussion = findDiscussion(input.ydiscussions, input.discussionId)
  if (!discussion) return false
  input.ydoc.transact(() => {
    discussion.set('resolved', input.resolved)
  }, 'discussion-resolve')
  return true
}

export function useDiscussions(options: UseDiscussionsOptions) {
  const { ydoc, ydiscussions, currentUser, canComment = false, canResolve = false } = options

  const [discussions, setDiscussions] = useState<DiscussionEntry[]>(() =>
    readDiscussions(ydiscussions),
  )
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const sync = () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }
      setDiscussions(readDiscussions(ydiscussions))
    }

    const schedule = () => {
      if (syncTimerRef.current) return
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null
        setDiscussions(readDiscussions(ydiscussions))
      }, DISCUSSION_SYNC_DEBOUNCE_MS)
    }

    sync()
    ydiscussions.observeDeep(schedule)
    return () => {
      ydiscussions.unobserveDeep(schedule)
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }
    }
  }, [ydiscussions])

  const byId = useMemo(() => {
    const map = new Map<string, DiscussionEntry>()
    for (const entry of discussions) map.set(entry.id, entry)
    return map
  }, [discussions])

  const createDiscussion = useCallback(
    (input: { title: string; text: string }): string | null => {
      if (!canComment || !currentUser?.id) return null
      const name = currentUser.name?.trim() || 'Unknown user'
      return createDiscussionInYArray({
        ydoc,
        ydiscussions,
        authorId: currentUser.id,
        authorName: name,
        title: input.title,
        text: input.text,
      })
    },
    [canComment, currentUser?.id, currentUser?.name, ydoc, ydiscussions],
  )

  const replyToDiscussion = useCallback(
    (discussionId: string, text: string): boolean => {
      if (!canComment || !currentUser?.id) return false
      const name = currentUser.name?.trim() || 'Unknown user'
      return replyToDiscussionInYArray({
        ydoc,
        ydiscussions,
        discussionId,
        authorId: currentUser.id,
        authorName: name,
        text,
      })
    },
    [canComment, currentUser?.id, currentUser?.name, ydoc, ydiscussions],
  )

  const setResolved = useCallback(
    (discussionId: string, resolved: boolean): boolean => {
      if (!canResolve) return false
      return setDiscussionResolvedInYArray({
        ydoc,
        ydiscussions,
        discussionId,
        resolved,
      })
    },
    [canResolve, ydoc, ydiscussions],
  )

  return {
    discussions,
    discussionsById: byId,
    createDiscussion,
    replyToDiscussion,
    setResolved,
  }
}

export type UseDiscussionsResult = ReturnType<typeof useDiscussions>
