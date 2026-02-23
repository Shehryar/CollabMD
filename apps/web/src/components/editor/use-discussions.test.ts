// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  createDiscussionInYArray,
  replyToDiscussionInYArray,
  setDiscussionResolvedInYArray,
} from './use-discussions'

describe('use-discussions helpers', () => {
  it('creates discussions and replies', () => {
    const ydoc = new Y.Doc()
    const ydiscussions = ydoc.getArray<Y.Map<unknown>>('discussions')

    const discussionId = createDiscussionInYArray({
      ydoc,
      ydiscussions,
      authorId: 'u-1',
      authorName: 'User',
      title: 'Thread',
      text: 'Body',
    })
    expect(discussionId).toBeTruthy()
    expect(ydiscussions.length).toBe(1)

    const replied = replyToDiscussionInYArray({
      ydoc,
      ydiscussions,
      discussionId: discussionId!,
      authorId: 'u-2',
      authorName: 'Reply User',
      text: 'Reply',
    })
    expect(replied).toBe(true)

    const discussion = ydiscussions.get(0)
    const thread = discussion.get('thread') as Y.Array<Y.Map<unknown>>
    expect(thread.length).toBe(1)
    expect((thread.get(0).get('author') as Y.Map<unknown>).get('name')).toBe('Reply User')
  })

  it('marks discussions as resolved', () => {
    const ydoc = new Y.Doc()
    const ydiscussions = ydoc.getArray<Y.Map<unknown>>('discussions')
    const id = createDiscussionInYArray({
      ydoc,
      ydiscussions,
      authorId: 'u-1',
      authorName: 'User',
      title: 'Thread',
      text: 'Body',
    })

    const ok = setDiscussionResolvedInYArray({
      ydoc,
      ydiscussions,
      discussionId: id!,
      resolved: true,
    })
    expect(ok).toBe(true)
    expect(ydiscussions.get(0).get('resolved')).toBe(true)
  })
})
