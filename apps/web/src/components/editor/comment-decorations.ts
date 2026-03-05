import {
  Extension,
  Range,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  gutter,
} from '@codemirror/view'
import * as Y from 'yjs'
import type { SuggestionData } from './use-comments'

const COMMENT_RECALC_DEBOUNCE_MS = 80

export interface AnchoredCommentRange {
  id: string
  from: number
  to: number
  resolved: boolean
  suggestion?: SuggestionData
}

interface CommentDecorationsOptions {
  ydoc: Y.Doc
  ytext: Y.Text
  ycomments: Y.Array<Y.Map<unknown>>
  onSelectComment?: (commentId: string) => void
}

interface CommentDecorationState {
  activeCommentId: string | null
  decorations: DecorationSet
  gutterMarkers: RangeSet<GutterMarker>
}

export const setActiveCommentEffect = StateEffect.define<string | null>()
const recalcCommentDecorationsEffect = StateEffect.define<number>()

function decodeRelativePosition(value: unknown): Y.RelativePosition | null {
  if (!(value instanceof Uint8Array)) return null
  try {
    return Y.decodeRelativePosition(value)
  } catch {
    return null
  }
}

function parseSuggestion(value: unknown): SuggestionData | undefined {
  if (!(value instanceof Y.Map)) return undefined

  const originalText =
    typeof value.get('originalText') === 'string' ? (value.get('originalText') as string) : ''
  const proposedText =
    typeof value.get('proposedText') === 'string' ? (value.get('proposedText') as string) : ''
  const rawStatus = value.get('status')
  const status = rawStatus === 'accepted' || rawStatus === 'dismissed' ? rawStatus : 'pending'

  return {
    originalText,
    proposedText,
    status,
  }
}

class SuggestionProposedWidget extends WidgetType {
  constructor(
    private readonly commentId: string,
    private readonly proposedText: string,
  ) {
    super()
  }

  eq(other: SuggestionProposedWidget): boolean {
    return this.commentId === other.commentId && this.proposedText === other.proposedText
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-suggestion-proposed'
    element.setAttribute('data-comment-id', this.commentId)
    element.textContent = ` ${this.proposedText}`
    return element
  }
}

export function listAnchoredCommentRanges(
  ydoc: Y.Doc,
  ytext: Y.Text,
  ycomments: Y.Array<Y.Map<unknown>>,
): AnchoredCommentRange[] {
  return ycomments.toArray().flatMap((value): AnchoredCommentRange[] => {
    if (!(value instanceof Y.Map)) return []

    const id = value.get('id')
    if (typeof id !== 'string') return []

    const start = decodeRelativePosition(value.get('anchorStart'))
    const end = decodeRelativePosition(value.get('anchorEnd'))
    if (!start || !end) return []

    const absoluteStart = Y.createAbsolutePositionFromRelativePosition(start, ydoc)
    const absoluteEnd = Y.createAbsolutePositionFromRelativePosition(end, ydoc)

    if (!absoluteStart || !absoluteEnd) return []
    if (absoluteStart.type !== ytext || absoluteEnd.type !== ytext) return []

    const from = Math.min(absoluteStart.index, absoluteEnd.index)
    const to = Math.max(absoluteStart.index, absoluteEnd.index)
    const suggestion = parseSuggestion(value.get('suggestion'))
    const resolved =
      value.get('resolved') === true ||
      suggestion?.status === 'accepted' ||
      suggestion?.status === 'dismissed'

    return [
      {
        id,
        from,
        to,
        resolved,
        suggestion,
      },
    ]
  })
}

function buildCommentDecorations(
  state: EditorView['state'],
  options: CommentDecorationsOptions,
  activeCommentId: string | null,
): Pick<CommentDecorationState, 'decorations' | 'gutterMarkers'> {
  const ranges = listAnchoredCommentRanges(options.ydoc, options.ytext, options.ycomments)
  const decorations: Array<Range<Decoration>> = []
  const lineMap = new Map<number, { active: boolean; hasUnresolved: boolean }>()

  for (const range of ranges) {
    const pendingSuggestion = range.suggestion?.status === 'pending' && !range.resolved

    if (pendingSuggestion) {
      if (range.from !== range.to) {
        const classes = ['cm-suggestion-original']
        if (range.id === activeCommentId) classes.push('cm-suggestion-original-active')
        decorations.push(
          Decoration.mark({
            class: classes.join(' '),
            attributes: {
              'data-comment-id': range.id,
            },
          }).range(range.from, range.to),
        )
      }
      decorations.push(
        Decoration.widget({
          widget: new SuggestionProposedWidget(range.id, range.suggestion?.proposedText ?? ''),
          side: 1,
        }).range(range.to),
      )
    } else if (range.from !== range.to) {
      const classes = ['cm-comment-highlight']
      if (range.resolved) classes.push('cm-comment-highlight-resolved')
      if (range.id === activeCommentId) classes.push('cm-comment-highlight-active')

      decorations.push(
        Decoration.mark({
          class: classes.join(' '),
          attributes: {
            'data-comment-id': range.id,
          },
        }).range(range.from, range.to),
      )
    }

    const fromLine = state.doc.lineAt(range.from)
    const toLine = state.doc.lineAt(range.to)
    for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber++) {
      const line = state.doc.line(lineNumber)
      const current = lineMap.get(line.from)
      if (!current) {
        lineMap.set(line.from, {
          active: range.id === activeCommentId,
          hasUnresolved: !range.resolved,
        })
      } else {
        lineMap.set(line.from, {
          active: current.active || range.id === activeCommentId,
          hasUnresolved: current.hasUnresolved || !range.resolved,
        })
      }
    }
  }

  const markerBuilder = new RangeSetBuilder<GutterMarker>()
  for (const [lineFrom, flags] of lineMap) {
    markerBuilder.add(
      lineFrom,
      lineFrom,
      new CommentGutterMarker(flags.active, !flags.hasUnresolved),
    )
  }

  return {
    decorations: Decoration.set(decorations, true),
    gutterMarkers: markerBuilder.finish(),
  }
}

function getCommentIdsForLine(
  state: EditorView['state'],
  options: CommentDecorationsOptions,
  lineFrom: number,
): string[] {
  const line = state.doc.lineAt(lineFrom)
  const ranges = listAnchoredCommentRanges(options.ydoc, options.ytext, options.ycomments)

  return ranges
    .filter((range) => {
      const startsBeforeLineEnds = range.from <= line.to
      const endsAfterLineStarts = range.to >= line.from
      return startsBeforeLineEnds && endsAfterLineStarts
    })
    .map((range) => range.id)
}

class CommentGutterMarker extends GutterMarker {
  constructor(
    private readonly active: boolean,
    private readonly resolved: boolean,
  ) {
    super()
  }

  eq(other: CommentGutterMarker) {
    return this.active === other.active && this.resolved === other.resolved
  }

  toDOM() {
    const element = document.createElement('span')
    element.className = 'cm-comment-gutter-dot'
    if (this.active) element.classList.add('cm-comment-gutter-dot-active')
    if (this.resolved) element.classList.add('cm-comment-gutter-dot-resolved')
    return element
  }
}

function hasRecalcEffect(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(recalcCommentDecorationsEffect)),
  )
}

export const commentDecorationsTheme = EditorView.theme({
  '.cm-comment-highlight': {
    backgroundColor: '#fef9c3',
    borderRadius: '2px',
    cursor: 'pointer',
  },
  '.cm-comment-highlight-resolved': {
    backgroundColor: '#fef3c7',
    opacity: 0.55,
  },
  '.cm-comment-highlight-active': {
    backgroundColor: '#fde68a',
    boxShadow: 'inset 0 0 0 1px #f59e0b66',
  },
  '.cm-suggestion-original': {
    color: '#dc2626',
    backgroundColor: '#fef2f2',
    textDecoration: 'line-through',
    textDecorationColor: '#dc2626',
    textDecorationThickness: '2px',
    borderRadius: '2px',
    cursor: 'pointer',
  },
  '.cm-suggestion-original-active': {
    boxShadow: 'inset 0 0 0 1px #dc262666',
  },
  '.cm-suggestion-proposed': {
    display: 'inline',
    marginLeft: '2px',
    color: '#16a34a',
    backgroundColor: '#f0fdf4',
    borderRadius: '2px',
    padding: '0 2px',
    cursor: 'pointer',
  },
  '.cm-comment-gutter': {
    width: '14px',
  },
  '.cm-comment-gutter-dot': {
    display: 'inline-block',
    width: '7px',
    height: '7px',
    borderRadius: '999px',
    backgroundColor: '#c2682b',
    opacity: 0.7,
    marginLeft: '1px',
  },
  '.cm-comment-gutter-dot-active': {
    opacity: 1,
    transform: 'scale(1.1)',
  },
  '.cm-comment-gutter-dot-resolved': {
    opacity: 0.35,
  },
})

export function setActiveComment(view: EditorView, commentId: string | null) {
  view.dispatch({ effects: setActiveCommentEffect.of(commentId) })
}

export function createCommentDecorations(options: CommentDecorationsOptions): Extension {
  const commentDecorationField = StateField.define<CommentDecorationState>({
    create(state) {
      const built = buildCommentDecorations(state, options, null)
      return {
        activeCommentId: null,
        decorations: built.decorations,
        gutterMarkers: built.gutterMarkers,
      }
    },
    update(value, transaction) {
      let nextActiveCommentId = value.activeCommentId
      let shouldRebuild = false

      for (const effect of transaction.effects) {
        if (effect.is(setActiveCommentEffect)) {
          nextActiveCommentId = effect.value
          shouldRebuild = true
          continue
        }

        if (effect.is(recalcCommentDecorationsEffect)) {
          shouldRebuild = true
        }
      }

      if (shouldRebuild) {
        const built = buildCommentDecorations(transaction.state, options, nextActiveCommentId)
        return {
          activeCommentId: nextActiveCommentId,
          decorations: built.decorations,
          gutterMarkers: built.gutterMarkers,
        }
      }

      if (transaction.docChanged) {
        return {
          ...value,
          decorations: value.decorations.map(transaction.changes),
          gutterMarkers: value.gutterMarkers.map(transaction.changes),
        }
      }

      return value
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      gutter({
        class: 'cm-comment-gutter',
        markers: (view) => view.state.field(field).gutterMarkers,
        initialSpacer: () => new CommentGutterMarker(false, false),
        domEventHandlers: {
          mousedown: (view, line) => {
            const ids = getCommentIdsForLine(view.state, options, line.from)
            if (ids.length === 0) return false

            const id = ids[0]
            view.dispatch({ effects: setActiveCommentEffect.of(id) })
            options.onSelectComment?.(id)
            return true
          },
        },
      }),
    ],
  })

  const commentInteractionHandlers = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null
      if (!target) return false

      const highlighted = target.closest<HTMLElement>('[data-comment-id]')
      const id = highlighted?.getAttribute('data-comment-id')
      if (!id) return false

      view.dispatch({ effects: setActiveCommentEffect.of(id) })
      options.onSelectComment?.(id)
      return true
    },
  })

  const yCommentObserverPlugin = ViewPlugin.fromClass(
    class {
      private recalcTimer: ReturnType<typeof setTimeout> | null = null

      constructor(private readonly view: EditorView) {
        options.ycomments.observeDeep(this.handleCommentChange)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.scheduleRecalc()
        }
        if (hasRecalcEffect(update) && this.recalcTimer) {
          clearTimeout(this.recalcTimer)
          this.recalcTimer = null
        }
      }

      destroy() {
        options.ycomments.unobserveDeep(this.handleCommentChange)
        if (this.recalcTimer) {
          clearTimeout(this.recalcTimer)
          this.recalcTimer = null
        }
      }

      private readonly handleCommentChange = () => {
        this.scheduleRecalc()
      }

      private scheduleRecalc() {
        if (this.recalcTimer) return
        this.recalcTimer = setTimeout(() => {
          this.recalcTimer = null
          this.view.dispatch({ effects: recalcCommentDecorationsEffect.of(Date.now()) })
        }, COMMENT_RECALC_DEBOUNCE_MS)
      }
    },
  )

  return [
    commentDecorationField,
    commentInteractionHandlers,
    yCommentObserverPlugin,
    commentDecorationsTheme,
  ]
}
