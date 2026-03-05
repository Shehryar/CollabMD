import { EditorState, type Extension, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { editorModeField, setEditorModeEffect } from './editor-mode'

const FLUSH_IDLE_MS = 400

interface SuggestionBuffer {
  from: number
  to: number
  originalText: string
  proposedText: string
  idleTimer: ReturnType<typeof setTimeout> | null
}

export interface SuggestionInterceptorOptions {
  createSuggestion: (input: {
    from: number
    to: number
    text: string
    originalText: string
    proposedText: string
    source: 'browser'
  }) => string | null
}

function isRemoteTransaction(tr: Transaction): boolean {
  return tr.annotation(Transaction.remote) === true
}

function isUndoRedo(tr: Transaction): boolean {
  return (
    tr.annotation(Transaction.userEvent)?.startsWith('undo') === true ||
    tr.annotation(Transaction.userEvent)?.startsWith('redo') === true
  )
}

export function createSuggestionInterceptor(options: SuggestionInterceptorOptions): Extension {
  let buffer: SuggestionBuffer | null = null

  function flush(): void {
    if (!buffer) return
    const current = buffer
    buffer = null

    if (current.idleTimer) {
      clearTimeout(current.idleTimer)
      current.idleTimer = null
    }

    if (current.originalText === current.proposedText) return
    if (current.originalText.length === 0 && current.proposedText.length === 0) return

    const from = current.from
    const to = from + current.originalText.length

    setTimeout(() => {
      options.createSuggestion({
        from,
        to,
        text: 'Suggested edit',
        originalText: current.originalText,
        proposedText: current.proposedText,
        source: 'browser',
      })
    }, 0)
  }

  function resetIdleTimer(): void {
    if (!buffer) return
    if (buffer.idleTimer) clearTimeout(buffer.idleTimer)
    buffer.idleTimer = setTimeout(() => flush(), FLUSH_IDLE_MS)
  }

  const transactionFilter = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr
    if (isRemoteTransaction(tr)) return tr
    if (isUndoRedo(tr)) return tr

    const mode = tr.startState.field(editorModeField, false)
    if (mode !== 'suggesting') return tr

    const view = (tr as unknown as { view?: EditorView }).view
    if (!view) return tr

    let changeFrom = Infinity
    let changeTo = -Infinity
    let insertedText = ''
    let deletedText = ''

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changeFrom = Math.min(changeFrom, fromA)
      changeTo = Math.max(changeTo, toA)
      deletedText += tr.startState.doc.sliceString(fromA, toA)
      insertedText += inserted.toString()
    })

    if (changeFrom === Infinity) return tr

    if (buffer) {
      const bufferEnd = buffer.from + buffer.originalText.length
      const isContiguous = changeFrom >= buffer.from && changeFrom <= bufferEnd + 1

      if (isContiguous) {
        const offsetInOriginal = changeFrom - buffer.from
        const deleteEndInOriginal = changeTo - buffer.from

        if (deleteEndInOriginal <= buffer.originalText.length) {
          const proposedOffset = offsetInOriginal
          const proposedDeleteEnd = Math.min(
            proposedOffset + (changeTo - changeFrom),
            buffer.proposedText.length,
          )

          buffer.proposedText =
            buffer.proposedText.slice(0, proposedOffset) +
            insertedText +
            buffer.proposedText.slice(proposedDeleteEnd)
        } else {
          const extraOriginal = tr.startState.doc.sliceString(
            buffer.from + buffer.originalText.length,
            changeTo,
          )
          buffer.originalText += extraOriginal

          const proposedOffset = offsetInOriginal
          buffer.proposedText = buffer.proposedText.slice(0, proposedOffset) + insertedText
        }

        resetIdleTimer()
        return []
      }

      flush()
    }

    buffer = {
      from: changeFrom,
      to: changeTo,
      originalText: deletedText,
      proposedText: insertedText,
      idleTimer: null,
    }
    resetIdleTimer()

    return []
  })

  const cursorMoveListener = EditorView.updateListener.of((update) => {
    if (!buffer) return
    if (!update.selectionSet) return

    const mode = update.state.field(editorModeField, false)
    if (mode !== 'suggesting') return

    const cursor = update.state.selection.main.head
    const bufferEnd = buffer.from + buffer.originalText.length
    const isFar = cursor < buffer.from - 1 || cursor > bufferEnd + 1
    if (isFar) {
      flush()
    }
  })

  const cleanupOnModeChange = EditorView.updateListener.of((update) => {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setEditorModeEffect) && effect.value !== 'suggesting') {
          flush()
        }
      }
    }
  })

  return [transactionFilter, cursorMoveListener, cleanupOnModeChange]
}
