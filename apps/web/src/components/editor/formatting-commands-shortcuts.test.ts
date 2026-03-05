// @vitest-environment jsdom
/**
 * Tests for the new formatting shortcuts added in T-104.
 *
 * These tests verify that the command functions (toggleBlockquote, etc.)
 * produce the correct markdown output. They mirror the pattern used in
 * formatting-commands.test.ts. Both test files depend on @codemirror
 * packages which must be resolvable in the vitest environment.
 *
 * Run with: cd apps/web && npx vitest run src/components/editor/formatting-commands-shortcuts.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  toggleBlockquote,
  toggleBulletList,
  toggleNumberedList,
  toggleCheckboxList,
  insertCodeBlock,
  setHeading,
} from './formatting-commands'

let view: EditorView

function createView(doc: string, anchor: number, head?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.range(anchor, head ?? anchor)]),
  })
  const parent = document.createElement('div')
  view = new EditorView({ state, parent })
  return view
}

function doc(): string {
  return view.state.doc.toString()
}

afterEach(() => {
  view?.destroy()
})

// --- Blockquote ---

describe('toggleBlockquote', () => {
  it('adds > prefix to line', () => {
    createView('some text', 0)
    toggleBlockquote(view)
    expect(doc()).toBe('> some text')
  })

  it('removes > prefix when toggled off', () => {
    createView('> some text', 2)
    toggleBlockquote(view)
    expect(doc()).toBe('some text')
  })
})

// --- New shortcut-mapped commands produce correct markdown ---

describe('Mod-Shift-7: numbered list', () => {
  it('adds 1. prefix', () => {
    createView('item', 0)
    toggleNumberedList(view)
    expect(doc()).toBe('1. item')
  })

  it('removes 1. prefix when toggled off', () => {
    createView('1. item', 3)
    toggleNumberedList(view)
    expect(doc()).toBe('item')
  })
})

describe('Mod-Shift-8: bullet list', () => {
  it('adds - prefix', () => {
    createView('item', 0)
    toggleBulletList(view)
    expect(doc()).toBe('- item')
  })

  it('removes - prefix when toggled off', () => {
    createView('- item', 2)
    toggleBulletList(view)
    expect(doc()).toBe('item')
  })
})

describe('Mod-Shift-9: checkbox list', () => {
  it('adds - [ ] prefix', () => {
    createView('task', 0)
    toggleCheckboxList(view)
    expect(doc()).toBe('- [ ] task')
  })

  it('removes - [ ] prefix when toggled off', () => {
    createView('- [ ] task', 6)
    toggleCheckboxList(view)
    expect(doc()).toBe('task')
  })
})

describe('Mod-Alt-c: code block', () => {
  it('inserts fenced code block on empty line', () => {
    createView('', 0)
    insertCodeBlock(view)
    expect(doc()).toBe('```\n\n```')
  })

  it('adds newline before code block when cursor is mid-line', () => {
    createView('hello', 5)
    insertCodeBlock(view)
    expect(doc()).toBe('hello\n```\n\n```')
  })
})

describe('Mod-1/2/3: heading levels', () => {
  it('Mod-1 adds # prefix', () => {
    createView('title', 0)
    setHeading(view, 1)
    expect(doc()).toBe('# title')
  })

  it('Mod-2 adds ## prefix', () => {
    createView('title', 0)
    setHeading(view, 2)
    expect(doc()).toBe('## title')
  })

  it('Mod-3 adds ### prefix', () => {
    createView('title', 0)
    setHeading(view, 3)
    expect(doc()).toBe('### title')
  })

  it('Mod-1 toggles off existing H1', () => {
    createView('# title', 2)
    setHeading(view, 1)
    expect(doc()).toBe('title')
  })

  it('Mod-2 switches H1 to H2', () => {
    createView('# title', 2)
    setHeading(view, 2)
    expect(doc()).toBe('## title')
  })
})

describe('Mod-Shift-.: blockquote', () => {
  it('adds > prefix', () => {
    createView('quote this', 0)
    toggleBlockquote(view)
    expect(doc()).toBe('> quote this')
  })

  it('removes > prefix when toggled off', () => {
    createView('> quote this', 2)
    toggleBlockquote(view)
    expect(doc()).toBe('quote this')
  })
})
