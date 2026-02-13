// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  acceptSuggestionInYArray,
  createCommentInYArray,
  createSuggestionInYArray,
  dismissSuggestionInYArray,
  listInlineComments,
  replyToCommentInYArray,
  setCommentResolvedInYArray,
  toAbsoluteCommentRange,
  useComments,
} from './use-comments'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  container?.remove()
  root = null
  container = null
})

function setupDoc(content: string) {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('codemirror')
  const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')

  ytext.insert(0, content)

  return { ydoc, ytext, ycomments }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('comment CRDT operations', () => {
  it('creates, replies, and resolves comments in Y.Array', () => {
    const { ydoc, ytext, ycomments } = setupDoc('hello world')

    const commentId = createCommentInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 0,
      to: 5,
      authorId: 'user-1',
      authorName: 'Alice',
      text: 'Need a stronger intro',
      source: 'browser',
      createdAt: '2026-02-13T10:00:00.000Z',
    })

    expect(commentId).toBeTruthy()
    expect(ycomments.length).toBe(1)

    const replied = replyToCommentInYArray({
      ydoc,
      ycomments,
      commentId: commentId as string,
      authorId: 'user-2',
      authorName: 'Bob',
      text: 'I can update that',
      createdAt: '2026-02-13T10:01:00.000Z',
    })

    expect(replied).toBe(true)

    const resolved = setCommentResolvedInYArray({
      ydoc,
      ycomments,
      commentId: commentId as string,
      resolved: true,
    })

    expect(resolved).toBe(true)

    const stored = ycomments.get(0)
    const thread = stored.get('thread') as Y.Array<Y.Map<any>>

    expect(stored.get('authorName')).toBe('Alice')
    expect(stored.get('resolved')).toBe(true)
    expect(thread.length).toBe(1)
    expect(thread.get(0).get('authorName')).toBe('Bob')
  })

  it('keeps anchor ranges stable after edits before the anchor', () => {
    const { ydoc, ytext, ycomments } = setupDoc('hello world')

    const commentId = createCommentInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 6,
      to: 11,
      authorId: 'user-1',
      authorName: 'Alice',
      text: 'Focus this wording',
      source: 'browser',
      createdAt: '2026-02-13T10:00:00.000Z',
    })

    expect(commentId).toBeTruthy()

    ytext.insert(0, 'greetings ')

    const stored = ycomments.get(0)
    const range = toAbsoluteCommentRange(
      ydoc,
      ytext,
      stored.get('anchorStart') as Uint8Array,
      stored.get('anchorEnd') as Uint8Array,
    )

    expect(range).toEqual({ from: 16, to: 21 })
  })

  it('creates suggestions with nested suggestion metadata', () => {
    const { ydoc, ytext, ycomments } = setupDoc('hello world')

    const commentId = createSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 6,
      to: 11,
      authorId: 'user-1',
      authorName: 'Alice',
      text: 'Suggested edit',
      originalText: 'world',
      proposedText: 'team',
      source: 'browser',
      createdAt: '2026-02-13T10:00:00.000Z',
    })

    expect(commentId).toBeTruthy()
    const stored = ycomments.get(0)
    const suggestion = stored.get('suggestion') as Y.Map<unknown>
    expect(suggestion.get('originalText')).toBe('world')
    expect(suggestion.get('proposedText')).toBe('team')
    expect(suggestion.get('status')).toBe('pending')
  })

  it('accepts suggestions by replacing anchored text and marking resolved', () => {
    const { ydoc, ytext, ycomments } = setupDoc('hello world')

    const commentId = createSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 6,
      to: 11,
      authorId: 'user-1',
      authorName: 'Alice',
      text: 'Suggested edit',
      originalText: 'world',
      proposedText: 'team',
      source: 'browser',
      createdAt: '2026-02-13T10:00:00.000Z',
    })

    const accepted = acceptSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      commentId: commentId as string,
    })

    expect(accepted).toBe(true)
    expect(ytext.toString()).toBe('hello team')

    const suggestion = (ycomments.get(0).get('suggestion') as Y.Map<unknown>)
    expect(suggestion.get('status')).toBe('accepted')
    expect(ycomments.get(0).get('resolved')).toBe(true)
  })

  it('dismisses suggestions without changing document text', () => {
    const { ydoc, ytext, ycomments } = setupDoc('hello world')

    const commentId = createSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 6,
      to: 11,
      authorId: 'user-1',
      authorName: 'Alice',
      text: 'Suggested edit',
      originalText: 'world',
      proposedText: 'team',
      source: 'browser',
      createdAt: '2026-02-13T10:00:00.000Z',
    })

    const dismissed = dismissSuggestionInYArray({
      ydoc,
      ycomments,
      commentId: commentId as string,
    })

    expect(dismissed).toBe(true)
    expect(ytext.toString()).toBe('hello world')
    const suggestion = (ycomments.get(0).get('suggestion') as Y.Map<unknown>)
    expect(suggestion.get('status')).toBe('dismissed')
    expect(ycomments.get(0).get('resolved')).toBe(true)
  })

  it('round-trips suggestion data through comment parsing', () => {
    const { ydoc, ytext, ycomments } = setupDoc('hello world')

    createSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 6,
      to: 11,
      authorId: 'user-1',
      authorName: 'Alice',
      text: 'Suggested edit',
      originalText: 'world',
      proposedText: 'team',
      source: 'browser',
      createdAt: '2026-02-13T10:00:00.000Z',
    })

    const parsed = listInlineComments(ycomments)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.suggestion).toEqual({
      originalText: 'world',
      proposedText: 'team',
      status: 'pending',
    })
  })
})

describe('useComments hook', () => {
  it('updates comment list from Y.Array observe events', async () => {
    const { ydoc, ytext, ycomments } = setupDoc('alpha beta gamma')
    type HookSnapshot = {
      comments: Array<{
        text: string
        resolved: boolean
        thread: Array<{ text: string }>
      }>
      replyToComment: (commentId: string, text: string) => boolean
      setResolved: (commentId: string, resolved: boolean) => boolean
    }
    let snapshot: HookSnapshot | null = null
    const requireSnapshot = (): HookSnapshot => {
      if (!snapshot) {
        throw new Error('snapshot not available')
      }
      return snapshot
    }

    function Harness() {
      snapshot = useComments({
        ydoc,
        ytext,
        ycomments,
        currentUser: { id: 'user-1', name: 'Alice' },
        canComment: true,
        canResolve: true,
      }) as HookSnapshot
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(Harness))
    })

    expect(requireSnapshot().comments).toHaveLength(0)

    let commentId: string | null = null
    await act(async () => {
      commentId = createCommentInYArray({
        ydoc,
        ytext,
        ycomments,
        from: 0,
        to: 5,
        authorId: 'user-2',
        authorName: 'Bob',
        text: 'First note',
        source: 'browser',
      })
      await wait(80)
    })

    expect(commentId).toBeTruthy()
    const afterCreate = requireSnapshot()
    expect(afterCreate.comments).toHaveLength(1)
    expect(afterCreate.comments[0].text).toBe('First note')

    await act(async () => {
      const current = requireSnapshot()
      current.replyToComment(commentId as string, 'Reply from hook')
      current.setResolved(commentId as string, true)
      await wait(80)
    })

    const afterReply = requireSnapshot()
    expect(afterReply.comments[0].thread).toHaveLength(1)
    expect(afterReply.comments[0].thread[0].text).toBe('Reply from hook')
    expect(afterReply.comments[0].resolved).toBe(true)
  })
})
