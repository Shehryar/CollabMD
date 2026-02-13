// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createCommentDecorations, listAnchoredCommentRanges, setActiveComment } from './comment-decorations'
import {
  acceptSuggestionInYArray,
  createInlineComment,
  createSuggestionInYArray,
  dismissSuggestionInYArray,
} from './use-comments'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('comment decorations', () => {
  let view: EditorView | null = null
  let ydoc: Y.Doc | null = null

  afterEach(() => {
    view?.destroy()
    view = null
    ydoc?.destroy()
    ydoc = null
  })

  it('converts comment anchors to absolute ranges', () => {
    ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')

    ydoc.transact(() => {
      ytext.insert(0, 'hello world')
    })

    const commentId = createInlineComment(ydoc, ytext, ycomments, {
      from: 0,
      to: 5,
      text: 'Intro word',
      authorId: 'u-1',
      authorName: 'Ava',
      source: 'browser',
    })

    const ranges = listAnchoredCommentRanges(ydoc, ytext, ycomments)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toMatchObject({
      id: commentId,
      from: 0,
      to: 5,
      resolved: false,
    })
  })

  it('renders highlights and gutter dots, and supports active selection styling', async () => {
    ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')

    ydoc.transact(() => {
      ytext.insert(0, 'line one\nline two')
    })

    const commentId = createInlineComment(ydoc, ytext, ycomments, {
      from: 0,
      to: 8,
      text: 'comment',
      authorId: 'u-1',
      authorName: 'Ava',
      source: 'browser',
    })

    let selectedCommentId: string | null = null

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        createCommentDecorations({
          ydoc,
          ytext,
          ycomments,
          onSelectComment: (id) => {
            selectedCommentId = id
          },
        }),
      ],
    })

    const parent = document.createElement('div')
    document.body.append(parent)
    view = new EditorView({ state, parent })

    await wait(100)

    const highlight = view.dom.querySelector<HTMLElement>('.cm-comment-highlight')
    expect(highlight).not.toBeNull()

    const gutterDot = view.dom.querySelector<HTMLElement>('.cm-comment-gutter-dot')
    expect(gutterDot).not.toBeNull()

    highlight?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(selectedCommentId).toBe(commentId)

    setActiveComment(view, commentId)
    await wait(10)

    const activeHighlight = view.dom.querySelector('.cm-comment-highlight-active')
    expect(activeHighlight).not.toBeNull()

    parent.remove()
  })

  it('updates decorations when the comments array changes', async () => {
    ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')

    ydoc.transact(() => {
      ytext.insert(0, 'abc def ghi')
    })

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        createCommentDecorations({
          ydoc,
          ytext,
          ycomments,
        }),
      ],
    })

    const parent = document.createElement('div')
    document.body.append(parent)
    view = new EditorView({ state, parent })

    expect(view.dom.querySelector('.cm-comment-highlight')).toBeNull()

    createInlineComment(ydoc, ytext, ycomments, {
      from: 4,
      to: 7,
      text: 'mid',
      authorId: 'u-1',
      authorName: 'Ava',
      source: 'browser',
    })

    await wait(120)

    expect(view.dom.querySelector('.cm-comment-highlight')).not.toBeNull()

    parent.remove()
  })

  it('renders pending suggestion ranges as strike-through + proposed widget', async () => {
    ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')

    ydoc.transact(() => {
      ytext.insert(0, 'hello world')
    })

    createSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 0,
      to: 5,
      text: 'Suggested edit',
      originalText: 'hello',
      proposedText: 'greetings',
      authorId: 'u-1',
      authorName: 'Ava',
      source: 'browser',
    })

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        createCommentDecorations({
          ydoc,
          ytext,
          ycomments,
        }),
      ],
    })

    const parent = document.createElement('div')
    document.body.append(parent)
    view = new EditorView({ state, parent })

    await wait(100)

    const original = view.dom.querySelector<HTMLElement>('.cm-suggestion-original')
    const proposed = view.dom.querySelector<HTMLElement>('.cm-suggestion-proposed')
    expect(original).not.toBeNull()
    expect(proposed).not.toBeNull()
    expect(proposed?.textContent).toContain('greetings')

    parent.remove()
  })

  it('renders accepted and dismissed suggestions as resolved highlights', async () => {
    ydoc = new Y.Doc()
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')

    ydoc.transact(() => {
      ytext.insert(0, 'hello world')
    })

    const acceptedId = createSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 0,
      to: 5,
      text: 'Suggested edit',
      originalText: 'hello',
      proposedText: 'greetings',
      authorId: 'u-1',
      authorName: 'Ava',
      source: 'browser',
    })
    const dismissedId = createSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      from: 6,
      to: 11,
      text: 'Suggested edit',
      originalText: 'world',
      proposedText: 'team',
      authorId: 'u-1',
      authorName: 'Ava',
      source: 'browser',
    })

    acceptSuggestionInYArray({
      ydoc,
      ytext,
      ycomments,
      commentId: acceptedId as string,
    })
    dismissSuggestionInYArray({
      ydoc,
      ycomments,
      commentId: dismissedId as string,
    })

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        createCommentDecorations({
          ydoc,
          ytext,
          ycomments,
        }),
      ],
    })

    const parent = document.createElement('div')
    document.body.append(parent)
    view = new EditorView({ state, parent })

    await wait(100)

    expect(view.dom.querySelectorAll('.cm-comment-highlight-resolved').length).toBeGreaterThan(0)
    expect(view.dom.querySelector('.cm-suggestion-original')).toBeNull()

    parent.remove()
  })
})
