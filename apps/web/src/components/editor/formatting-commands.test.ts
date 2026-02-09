// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  toggleBold,
  toggleItalic,
  toggleCode,
  toggleStrikethrough,
  setHeading,
  toggleBulletList,
  toggleNumberedList,
  toggleCheckboxList,
  insertLink,
  insertImage,
  insertCodeBlock,
  insertHorizontalRule,
  insertTable,
} from './formatting-commands'

let view: EditorView

function createView(doc: string, anchor: number, head?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([
      EditorSelection.range(anchor, head ?? anchor),
    ]),
  })
  const parent = document.createElement('div')
  view = new EditorView({ state, parent })
  return view
}

function doc(): string {
  return view.state.doc.toString()
}

function sel(): { from: number; to: number } {
  const { from, to } = view.state.selection.main
  return { from, to }
}

afterEach(() => {
  view?.destroy()
})

// --- Inline formatting ---

describe('toggleBold', () => {
  it('wraps selected text with **', () => {
    createView('hello world', 0, 5)
    toggleBold(view)
    expect(doc()).toBe('**hello** world')
  })

  it('unwraps text that is already wrapped with **', () => {
    createView('**hello** world', 0, 9)
    toggleBold(view)
    expect(doc()).toBe('hello world')
  })

  it('removes surrounding ** when selection is inside markers', () => {
    createView('**hello** world', 2, 7)
    toggleBold(view)
    expect(doc()).toBe('hello world')
  })

  it('inserts empty markers at cursor when nothing selected', () => {
    createView('hello', 5)
    toggleBold(view)
    expect(doc()).toBe('hello****')
  })
})

describe('toggleItalic', () => {
  it('wraps selected text with _', () => {
    createView('hello world', 0, 5)
    toggleItalic(view)
    expect(doc()).toBe('_hello_ world')
  })

  it('unwraps text already wrapped with _', () => {
    createView('_hello_ world', 0, 7)
    toggleItalic(view)
    expect(doc()).toBe('hello world')
  })
})

describe('toggleCode', () => {
  it('wraps selected text with backticks', () => {
    createView('const x = 1', 0, 7)
    toggleCode(view)
    expect(doc()).toBe('`const x` = 1')
  })

  it('unwraps text already wrapped with backticks', () => {
    createView('`const x` = 1', 0, 9)
    toggleCode(view)
    expect(doc()).toBe('const x = 1')
  })
})

describe('toggleStrikethrough', () => {
  it('wraps selected text with ~~', () => {
    createView('hello world', 0, 5)
    toggleStrikethrough(view)
    expect(doc()).toBe('~~hello~~ world')
  })

  it('unwraps text already wrapped with ~~', () => {
    createView('~~hello~~ world', 0, 9)
    toggleStrikethrough(view)
    expect(doc()).toBe('hello world')
  })
})

// --- Headings ---

describe('setHeading', () => {
  it('adds # prefix for H1', () => {
    createView('hello', 0)
    setHeading(view, 1)
    expect(doc()).toBe('# hello')
  })

  it('adds ## prefix for H2', () => {
    createView('hello', 0)
    setHeading(view, 2)
    expect(doc()).toBe('## hello')
  })

  it('adds ### prefix for H3', () => {
    createView('hello', 0)
    setHeading(view, 3)
    expect(doc()).toBe('### hello')
  })

  it('removes heading prefix when toggled off', () => {
    createView('# hello', 2)
    setHeading(view, 1)
    expect(doc()).toBe('hello')
  })

  it('switches heading level from H1 to H2', () => {
    createView('# hello', 2)
    setHeading(view, 2)
    expect(doc()).toBe('## hello')
  })

  it('switches heading level from H3 to H1', () => {
    createView('### hello', 4)
    setHeading(view, 1)
    expect(doc()).toBe('# hello')
  })
})

// --- Lists ---

describe('toggleBulletList', () => {
  it('adds - prefix to line', () => {
    createView('item one', 0)
    toggleBulletList(view)
    expect(doc()).toBe('- item one')
  })

  it('removes - prefix when toggled off', () => {
    createView('- item one', 2)
    toggleBulletList(view)
    expect(doc()).toBe('item one')
  })
})

describe('toggleNumberedList', () => {
  it('adds 1. prefix to line', () => {
    createView('item one', 0)
    toggleNumberedList(view)
    expect(doc()).toBe('1. item one')
  })

  it('removes 1. prefix when toggled off', () => {
    createView('1. item one', 3)
    toggleNumberedList(view)
    expect(doc()).toBe('item one')
  })
})

describe('toggleCheckboxList', () => {
  it('adds - [ ] prefix to line', () => {
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

// --- Insert commands ---

describe('insertLink', () => {
  it('wraps selected text as link with placeholder url', () => {
    createView('click here', 0, 10)
    insertLink(view)
    expect(doc()).toBe('[click here](url)')
    // cursor should be selecting "url"
    expect(sel()).toEqual({ from: 12, to: 15 })
  })

  it('inserts placeholder link at cursor when no selection', () => {
    createView('hello ', 6)
    insertLink(view)
    expect(doc()).toBe('hello [text](url)')
  })
})

describe('insertImage', () => {
  it('inserts image syntax at cursor', () => {
    createView('', 0)
    insertImage(view)
    expect(doc()).toBe('![alt](url)')
  })
})

describe('insertCodeBlock', () => {
  it('inserts fenced code block at cursor on empty line', () => {
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

describe('insertHorizontalRule', () => {
  it('inserts --- at cursor on empty line', () => {
    createView('', 0)
    insertHorizontalRule(view)
    expect(doc()).toBe('---\n')
  })

  it('adds newline before --- when cursor is mid-line', () => {
    createView('hello', 5)
    insertHorizontalRule(view)
    expect(doc()).toBe('hello\n---\n')
  })
})

describe('insertTable', () => {
  it('inserts markdown table at cursor', () => {
    createView('', 0)
    insertTable(view)
    expect(doc()).toContain('| Header | Header |')
    expect(doc()).toContain('| ------ | ------ |')
    expect(doc()).toContain('| Cell   | Cell   |')
  })
})
