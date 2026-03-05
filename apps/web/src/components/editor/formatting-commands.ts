import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { keymap } from '@codemirror/view'

// --- Wrap / toggle helpers ---

function wrapSelection(view: EditorView, marker: string) {
  const { state } = view
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    // If already wrapped, unwrap
    if (text.startsWith(marker) && text.endsWith(marker) && text.length > marker.length * 2) {
      const inner = text.slice(marker.length, -marker.length)
      return {
        range: EditorSelection.range(range.from, range.from + inner.length),
        changes: { from: range.from, to: range.to, insert: inner },
      }
    }
    // Check if the surrounding text has markers
    const before = state.sliceDoc(range.from - marker.length, range.from)
    const after = state.sliceDoc(range.to, range.to + marker.length)
    if (before === marker && after === marker) {
      return {
        range: EditorSelection.range(
          range.from - marker.length,
          range.from + (range.to - range.from),
        ),
        changes: [
          { from: range.from - marker.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + marker.length, insert: '' },
        ],
      }
    }
    // Wrap selection
    const wrapped = marker + text + marker
    return {
      range: EditorSelection.range(
        range.from + marker.length,
        range.from + marker.length + text.length,
      ),
      changes: { from: range.from, to: range.to, insert: wrapped },
    }
  })
  view.dispatch(changes)
  view.focus()
}

function prefixLine(view: EditorView, prefix: string) {
  const { state } = view
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const lineText = line.text

    // If already has this prefix, remove it
    if (lineText.startsWith(prefix)) {
      return {
        range: EditorSelection.cursor(range.from - prefix.length),
        changes: {
          from: line.from,
          to: line.from + prefix.length,
          insert: '',
        },
      }
    }

    // Remove other heading prefixes before adding
    const headingMatch = lineText.match(/^#{1,6}\s/)
    if (headingMatch && prefix.startsWith('#')) {
      return {
        range: EditorSelection.cursor(
          line.from + prefix.length + (range.from - line.from - headingMatch[0].length),
        ),
        changes: {
          from: line.from,
          to: line.from + headingMatch[0].length,
          insert: prefix,
        },
      }
    }

    return {
      range: EditorSelection.cursor(range.from + prefix.length),
      changes: { from: line.from, insert: prefix },
    }
  })
  view.dispatch(changes)
  view.focus()
}

function insertAtCursor(view: EditorView, text: string, cursorOffset?: number) {
  const { state } = view
  const pos = state.selection.main.head
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: EditorSelection.cursor(pos + (cursorOffset ?? text.length)),
  })
  view.focus()
}

// --- Public command functions ---

export function toggleBold(view: EditorView) {
  wrapSelection(view, '**')
}

export function toggleItalic(view: EditorView) {
  wrapSelection(view, '_')
}

export function toggleCode(view: EditorView) {
  wrapSelection(view, '`')
}

export function toggleStrikethrough(view: EditorView) {
  wrapSelection(view, '~~')
}

export function setHeading(view: EditorView, level: 1 | 2 | 3) {
  prefixLine(view, '#'.repeat(level) + ' ')
}

export function toggleBulletList(view: EditorView) {
  prefixLine(view, '- ')
}

export function toggleNumberedList(view: EditorView) {
  prefixLine(view, '1. ')
}

export function toggleCheckboxList(view: EditorView) {
  prefixLine(view, '- [ ] ')
}

export function insertLink(view: EditorView) {
  const { state } = view
  const sel = state.sliceDoc(state.selection.main.from, state.selection.main.to)
  if (sel) {
    const replacement = `[${sel}](url)`
    view.dispatch({
      changes: {
        from: state.selection.main.from,
        to: state.selection.main.to,
        insert: replacement,
      },
      selection: EditorSelection.range(
        state.selection.main.from + sel.length + 2,
        state.selection.main.from + sel.length + 5,
      ),
    })
  } else {
    insertAtCursor(view, '[text](url)', 1)
  }
  view.focus()
}

export function insertImage(view: EditorView) {
  insertAtCursor(view, '![alt](url)', 2)
}

export function insertCodeBlock(view: EditorView) {
  const { state } = view
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  const prefix = line.from === pos ? '' : '\n'
  insertAtCursor(view, prefix + '```\n\n```', prefix.length + 4)
}

export function insertHorizontalRule(view: EditorView) {
  const { state } = view
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  const prefix = line.from === pos ? '' : '\n'
  insertAtCursor(view, prefix + '---\n')
}

export function insertTable(view: EditorView) {
  const { state } = view
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  const prefix = line.from === pos ? '' : '\n'
  const table = `${prefix}| Header | Header |
| ------ | ------ |
| Cell   | Cell   |
`
  insertAtCursor(view, table)
}

export function toggleBlockquote(view: EditorView) {
  prefixLine(view, '> ')
}

// --- Keymap extension ---

export const formattingKeymap = keymap.of([
  {
    key: 'Mod-b',
    run: (view) => {
      toggleBold(view)
      return true
    },
  },
  {
    key: 'Mod-i',
    run: (view) => {
      toggleItalic(view)
      return true
    },
  },
  {
    key: 'Mod-e',
    run: (view) => {
      toggleCode(view)
      return true
    },
  },
  {
    key: 'Mod-Shift-x',
    run: (view) => {
      toggleStrikethrough(view)
      return true
    },
  },
  {
    key: 'Mod-Shift-k',
    run: (view) => {
      insertLink(view)
      return true
    },
  },
  {
    key: 'Mod-Shift-7',
    run: (view) => {
      toggleNumberedList(view)
      return true
    },
  },
  {
    key: 'Mod-Shift-8',
    run: (view) => {
      toggleBulletList(view)
      return true
    },
  },
  {
    key: 'Mod-Shift-9',
    run: (view) => {
      toggleCheckboxList(view)
      return true
    },
  },
  {
    key: 'Mod-Shift-.',
    run: (view) => {
      toggleBlockquote(view)
      return true
    },
  },
  {
    key: 'Mod-Alt-c',
    run: (view) => {
      insertCodeBlock(view)
      return true
    },
  },
  {
    key: 'Mod-1',
    run: (view) => {
      setHeading(view, 1)
      return true
    },
  },
  {
    key: 'Mod-2',
    run: (view) => {
      setHeading(view, 2)
      return true
    },
  },
  {
    key: 'Mod-3',
    run: (view) => {
      setHeading(view, 3)
      return true
    },
  },
])
