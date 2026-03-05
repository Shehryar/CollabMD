// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { conflictPlugin, conflictTheme } from './conflict-decorations'

let view: EditorView | null = null

function createView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [conflictPlugin, conflictTheme],
  })
  const parent = document.createElement('div')
  document.body.append(parent)
  view = new EditorView({ state, parent })
  return view
}

function getDoc(): string {
  return view?.state.doc.toString() ?? ''
}

const conflictDoc = [
  'before',
  '<<<<<<< HEAD',
  'current line',
  '=======',
  'incoming line',
  '>>>>>>> feature',
  'after',
].join('\n')

afterEach(() => {
  if (view) {
    const parent = view.dom.parentElement
    view.destroy()
    parent?.remove()
    view = null
  }
})

describe('conflict decorations', () => {
  it('creates no decorations when the document has no conflict markers', () => {
    createView('hello world')

    expect(view?.dom.querySelector('.cm-conflict-marker')).toBeNull()
    expect(view?.dom.querySelector('.cm-conflict-actions')).toBeNull()
  })

  it('creates decorations for a single conflict block', () => {
    createView(conflictDoc)

    expect(view?.dom.querySelectorAll('.cm-conflict-marker').length).toBe(3)
    expect(view?.dom.querySelector('.cm-conflict-current')).not.toBeNull()
    expect(view?.dom.querySelector('.cm-conflict-incoming')).not.toBeNull()
    expect(view?.dom.querySelector('.cm-conflict-actions')).not.toBeNull()
  })

  it('Accept Current removes conflict markers and keeps current text', () => {
    createView(conflictDoc)

    const button = view?.dom.querySelector<HTMLButtonElement>(
      '.cm-conflict-btn[data-action="current"]',
    )
    button?.click()

    expect(getDoc()).toBe('before\ncurrent line\nafter')
  })

  it('Accept Incoming removes conflict markers and keeps incoming text', () => {
    createView(conflictDoc)

    const button = view?.dom.querySelector<HTMLButtonElement>(
      '.cm-conflict-btn[data-action="incoming"]',
    )
    button?.click()

    expect(getDoc()).toBe('before\nincoming line\nafter')
  })
})
