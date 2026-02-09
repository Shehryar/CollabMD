import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { EditorState, Range, StateEffect, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

// --- Toggle state ---

export const togglePreviewEffect = StateEffect.define<boolean>()

export const previewEnabled = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(togglePreviewEffect)) return e.value
    }
    return value
  },
})

// --- Link widget ---

class LinkWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly url: string
  ) {
    super()
  }

  toDOM() {
    const a = document.createElement('a')
    a.textContent = this.text
    a.href = this.url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.className = 'cm-md-link'
    a.addEventListener('click', (e) => {
      e.preventDefault()
      window.open(this.url, '_blank', 'noopener,noreferrer')
    })
    return a
  }

  eq(other: LinkWidget) {
    return this.text === other.text && this.url === other.url
  }

  ignoreEvent() {
    return false
  }
}

// --- Bullet widget ---

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span')
    span.textContent = '•'
    span.className = 'cm-md-bullet'
    return span
  }

  eq() {
    return true
  }
}

// --- Checkbox widget ---

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.textContent = this.checked ? '☑' : '☐'
    span.className = 'cm-md-checkbox'
    return span
  }

  eq(other: CheckboxWidget) {
    return this.checked === other.checked
  }
}

// --- Horizontal rule widget ---

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-md-hr'
    return hr
  }

  eq() {
    return true
  }
}

// --- Build decorations from syntax tree ---

function buildDecorations(state: EditorState): DecorationSet {
  if (!state.field(previewEnabled)) return Decoration.none

  const decorations: Range<Decoration>[] = []
  const tree = syntaxTree(state)
  const cursorHead = state.selection.main.head

  tree.iterate({
    enter(node) {
      const { from, to } = node
      const lineFrom = state.doc.lineAt(from)
      const lineTo = state.doc.lineAt(to)
      const cursorLine = state.doc.lineAt(cursorHead)

      // Don't decorate the line(s) the cursor is on — let user edit raw markdown
      const cursorOnNode =
        cursorLine.number >= lineFrom.number &&
        cursorLine.number <= lineTo.number

      switch (node.name) {
        // --- Headings ---
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6': {
          if (cursorOnNode) break
          const level = parseInt(node.name.slice(-1))
          const headingClasses: Record<number, string> = {
            1: 'cm-md-h1',
            2: 'cm-md-h2',
            3: 'cm-md-h3',
            4: 'cm-md-h4',
            5: 'cm-md-h5',
            6: 'cm-md-h6',
          }
          // Find the HeaderMark (the # symbols)
          const markNode = node.node.getChild('HeaderMark')
          if (markNode) {
            // Hide the "# " prefix
            decorations.push(
              Decoration.replace({}).range(markNode.from, markNode.to + 1)
            )
          }
          // Apply heading style to the rest
          decorations.push(
            Decoration.line({ class: headingClasses[level] }).range(
              lineFrom.from
            )
          )
          break
        }

        // --- Bold ---
        case 'StrongEmphasis': {
          if (cursorOnNode) break
          const text = state.sliceDoc(from, to)
          // Determine marker length (** or __)
          const marker = text.startsWith('**') ? '**' : '__'
          const mLen = marker.length
          // Hide opening marker
          decorations.push(
            Decoration.replace({}).range(from, from + mLen)
          )
          // Hide closing marker
          decorations.push(
            Decoration.replace({}).range(to - mLen, to)
          )
          // Style the inner text
          decorations.push(
            Decoration.mark({ class: 'cm-md-bold' }).range(
              from + mLen,
              to - mLen
            )
          )
          break
        }

        // --- Italic ---
        case 'Emphasis': {
          if (cursorOnNode) break
          const text = state.sliceDoc(from, to)
          const marker = text.startsWith('*') ? '*' : '_'
          // Hide opening marker
          decorations.push(
            Decoration.replace({}).range(from, from + marker.length)
          )
          // Hide closing marker
          decorations.push(
            Decoration.replace({}).range(to - marker.length, to)
          )
          // Style the inner text
          decorations.push(
            Decoration.mark({ class: 'cm-md-italic' }).range(
              from + marker.length,
              to - marker.length
            )
          )
          break
        }

        // --- Strikethrough ---
        case 'Strikethrough': {
          if (cursorOnNode) break
          decorations.push(
            Decoration.replace({}).range(from, from + 2)
          )
          decorations.push(
            Decoration.replace({}).range(to - 2, to)
          )
          decorations.push(
            Decoration.mark({ class: 'cm-md-strikethrough' }).range(
              from + 2,
              to - 2
            )
          )
          break
        }

        // --- Inline code ---
        case 'InlineCode': {
          if (cursorOnNode) break
          // Hide backticks
          decorations.push(
            Decoration.replace({}).range(from, from + 1)
          )
          decorations.push(
            Decoration.replace({}).range(to - 1, to)
          )
          decorations.push(
            Decoration.mark({ class: 'cm-md-code' }).range(from + 1, to - 1)
          )
          break
        }

        // --- Code blocks ---
        case 'FencedCode': {
          if (cursorOnNode) break
          decorations.push(
            Decoration.mark({ class: 'cm-md-codeblock' }).range(from, to)
          )
          break
        }

        // --- Links ---
        case 'Link': {
          if (cursorOnNode) break
          const linkNode = node.node
          const urlNode = linkNode.getChild('URL')
          // Get the link text from between [ and ]
          const fullText = state.sliceDoc(from, to)
          const textMatch = fullText.match(/^\[([^\]]*)\]/)
          const linkText = textMatch ? textMatch[1] : fullText
          const url = urlNode ? state.sliceDoc(urlNode.from, urlNode.to) : ''

          if (linkText && url) {
            decorations.push(
              Decoration.replace({
                widget: new LinkWidget(linkText, url),
              }).range(from, to)
            )
          }
          break
        }

        // --- Bullet lists ---
        case 'ListMark': {
          if (cursorOnNode) break
          const markText = state.sliceDoc(from, to).trim()
          if (markText === '-' || markText === '*' || markText === '+') {
            // Check if this is a checkbox item
            const afterMark = state.sliceDoc(to, to + 5)
            if (afterMark.startsWith(' [x]') || afterMark.startsWith(' [X]')) {
              decorations.push(
                Decoration.replace({
                  widget: new CheckboxWidget(true),
                }).range(from, to + 5)
              )
            } else if (afterMark.startsWith(' [ ]')) {
              decorations.push(
                Decoration.replace({
                  widget: new CheckboxWidget(false),
                }).range(from, to + 4)
              )
            } else {
              decorations.push(
                Decoration.replace({
                  widget: new BulletWidget(),
                }).range(from, to)
              )
            }
          }
          break
        }

        // --- Horizontal rule ---
        case 'HorizontalRule': {
          if (cursorOnNode) break
          decorations.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(),
            }).range(from, to)
          )
          break
        }

        // --- Blockquote ---
        case 'Blockquote': {
          if (cursorOnNode) break
          // Apply line decoration for each line in the blockquote
          for (let i = lineFrom.number; i <= lineTo.number; i++) {
            const line = state.doc.line(i)
            decorations.push(
              Decoration.line({ class: 'cm-md-blockquote' }).range(line.from)
            )
          }
          break
        }
      }
    },
  })

  return Decoration.set(decorations, true)
}

// --- ViewPlugin ---

export const markdownPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.some((t) =>
          t.effects.some((e) => e.is(togglePreviewEffect))
        )
      ) {
        this.decorations = buildDecorations(update.state)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

// --- Theme for preview decorations ---

export const markdownPreviewTheme = EditorView.theme({
  '.cm-md-h1': {
    fontSize: '1.75em',
    fontWeight: '700',
    lineHeight: '1.3',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h2': {
    fontSize: '1.45em',
    fontWeight: '600',
    lineHeight: '1.35',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h3': {
    fontSize: '1.2em',
    fontWeight: '600',
    lineHeight: '1.4',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h4': {
    fontSize: '1.1em',
    fontWeight: '600',
    lineHeight: '1.4',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h5': {
    fontSize: '1.05em',
    fontWeight: '600',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h6': {
    fontSize: '1em',
    fontWeight: '600',
    color: '#6b7280',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-bold': {
    fontWeight: '700',
  },
  '.cm-md-italic': {
    fontStyle: 'italic',
  },
  '.cm-md-strikethrough': {
    textDecoration: 'line-through',
    color: '#9ca3af',
  },
  '.cm-md-code': {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.9em',
    backgroundColor: '#f3f4f6',
    borderRadius: '3px',
    padding: '1px 4px',
  },
  '.cm-md-codeblock': {
    backgroundColor: '#f9fafb',
    borderRadius: '4px',
  },
  '.cm-md-link': {
    color: '#2563eb',
    textDecoration: 'underline',
    textDecorationColor: '#93c5fd',
    cursor: 'pointer',
    '&:hover': {
      textDecorationColor: '#2563eb',
    },
  },
  '.cm-md-bullet': {
    color: '#6b7280',
    fontSize: '0.9em',
  },
  '.cm-md-checkbox': {
    fontSize: '1.1em',
    cursor: 'default',
  },
  '.cm-md-hr': {
    border: 'none',
    borderTop: '2px solid #e5e7eb',
    margin: '8px 0',
  },
  '.cm-md-blockquote': {
    borderLeft: '3px solid #d1d5db',
    paddingLeft: '12px',
    color: '#6b7280',
  },
})
