import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

interface ConflictBlock {
  fullFrom: number
  fullTo: number
  startLineFrom: number
  separatorLineFrom: number
  endLineFrom: number
  currentFrom: number
  currentTo: number
  incomingFrom: number
  incomingTo: number
  currentText: string
  incomingText: string
}

const START_MARKER = /^<{7}/
const SEPARATOR_MARKER = /^={7}$/
const END_MARKER = /^>{7}/

type ResolutionMode = 'current' | 'incoming' | 'both'

function lineBreakWidth(lineTo: number, docLength: number): number {
  return lineTo < docLength ? 1 : 0
}

function hasConflictMarkers(state: EditorView['state']): boolean {
  return state.doc.toString().includes('<<<<<<<')
}

function scanConflictBlocks(state: EditorView['state']): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  const doc = state.doc
  const docLength = doc.length

  let startLine: { from: number; to: number } | null = null
  let separatorLine: { from: number; to: number } | null = null

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber)

    if (!startLine) {
      if (START_MARKER.test(line.text)) {
        startLine = { from: line.from, to: line.to }
      }
      continue
    }

    if (!separatorLine) {
      if (SEPARATOR_MARKER.test(line.text)) {
        separatorLine = { from: line.from, to: line.to }
      } else if (START_MARKER.test(line.text)) {
        startLine = { from: line.from, to: line.to }
      }
      continue
    }

    if (END_MARKER.test(line.text)) {
      const currentFrom = Math.min(
        startLine.to + lineBreakWidth(startLine.to, docLength),
        docLength,
      )
      const currentTo = separatorLine.from
      const incomingFrom = Math.min(
        separatorLine.to + lineBreakWidth(separatorLine.to, docLength),
        docLength,
      )
      const incomingTo = line.from
      const fullTo = Math.min(line.to + lineBreakWidth(line.to, docLength), docLength)

      blocks.push({
        fullFrom: startLine.from,
        fullTo,
        startLineFrom: startLine.from,
        separatorLineFrom: separatorLine.from,
        endLineFrom: line.from,
        currentFrom,
        currentTo,
        incomingFrom,
        incomingTo,
        currentText: doc.sliceString(currentFrom, currentTo),
        incomingText: doc.sliceString(incomingFrom, incomingTo),
      })

      startLine = null
      separatorLine = null
      continue
    }

    if (START_MARKER.test(line.text)) {
      startLine = { from: line.from, to: line.to }
      separatorLine = null
    }
  }

  return blocks
}

class ConflictActionsWidget extends WidgetType {
  constructor(private readonly block: ConflictBlock) {
    super()
  }

  eq(other: ConflictActionsWidget): boolean {
    return this.block.fullFrom === other.block.fullFrom && this.block.fullTo === other.block.fullTo
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-conflict-actions'

    const createButton = (label: string, action: ResolutionMode): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cm-conflict-btn'
      button.dataset.action = action
      button.textContent = label
      button.addEventListener('mousedown', (event) => {
        event.preventDefault()
      })
      button.addEventListener('click', (event) => {
        event.preventDefault()
        this.applyResolution(view, action)
      })
      return button
    }

    container.append(
      createButton('Accept Current', 'current'),
      createButton('Accept Incoming', 'incoming'),
      createButton('Accept Both', 'both'),
    )

    return container
  }

  ignoreEvent(): boolean {
    return false
  }

  private applyResolution(view: EditorView, mode: ResolutionMode): void {
    const replacement =
      mode === 'current'
        ? this.block.currentText
        : mode === 'incoming'
          ? this.block.incomingText
          : this.block.currentText + this.block.incomingText

    view.dispatch({
      changes: {
        from: this.block.fullFrom,
        to: this.block.fullTo,
        insert: replacement,
      },
    })
  }
}

function buildConflictDecorations(state: EditorView['state']): DecorationSet {
  if (!hasConflictMarkers(state)) return Decoration.none

  const blocks = scanConflictBlocks(state)
  if (blocks.length === 0) return Decoration.none

  const decorations: Array<Range<Decoration>> = []

  for (const block of blocks) {
    decorations.push(
      Decoration.widget({
        widget: new ConflictActionsWidget(block),
        side: -1,
      }).range(block.fullFrom),
    )

    decorations.push(
      Decoration.line({
        class: 'cm-conflict-marker cm-conflict-current-header',
      }).range(block.startLineFrom),
    )

    decorations.push(
      Decoration.line({
        class: 'cm-conflict-marker cm-conflict-separator',
      }).range(block.separatorLineFrom),
    )

    decorations.push(
      Decoration.line({
        class: 'cm-conflict-marker cm-conflict-incoming-header',
      }).range(block.endLineFrom),
    )

    if (block.currentFrom < block.currentTo) {
      decorations.push(
        Decoration.mark({ class: 'cm-conflict-current' }).range(block.currentFrom, block.currentTo),
      )
    }

    if (block.incomingFrom < block.incomingTo) {
      decorations.push(
        Decoration.mark({ class: 'cm-conflict-incoming' }).range(
          block.incomingFrom,
          block.incomingTo,
        ),
      )
    }
  }

  return Decoration.set(decorations, true)
}

export const conflictPlugin: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildConflictDecorations(view.state)
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return
      this.decorations = buildConflictDecorations(update.state)
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

export const conflictTheme = EditorView.theme({
  '.cm-conflict-current': { backgroundColor: 'rgba(34, 197, 94, 0.08)' },
  '.cm-conflict-incoming': { backgroundColor: 'rgba(59, 130, 246, 0.08)' },
  '.cm-conflict-marker': {
    backgroundColor: '#f3f4f6',
    color: '#9ca3af',
    fontFamily: 'monospace',
    fontSize: '0.85em',
  },
  '.cm-conflict-current-header::after': {
    content: '" Current"',
    color: '#6b7280',
  },
  '.cm-conflict-incoming-header::after': {
    content: '" Incoming"',
    color: '#6b7280',
  },
  '.cm-conflict-actions': {
    display: 'flex',
    gap: '8px',
    padding: '4px 0',
    fontSize: '12px',
    fontFamily: 'var(--font-jetbrains-mono), monospace',
  },
  '.cm-conflict-btn': {
    cursor: 'pointer',
    padding: '2px 8px',
    borderRadius: '3px',
    border: '1px solid #e5e7eb',
    backgroundColor: '#fff',
    color: '#374151',
    '&:hover': { backgroundColor: '#f9fafb' },
  },
})
