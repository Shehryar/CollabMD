import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type * as Y from 'yjs'
import { toAbsoluteCommentRange } from './use-comments'
import type { CommentEntry } from './use-comments'

interface AnchorKey {
  id: string
  anchorStart: Uint8Array
  anchorEnd: Uint8Array
}

export interface CommentPositionsResult {
  positions: Map<string, number>
  contentHeight: number
}

/**
 * Maps each comment to a document-relative Y position (pixels from document top)
 * using CodeMirror's `view.lineBlockAt(pos).top`.
 *
 * Positions are document-relative (not viewport-relative), so they stay stable
 * across scrolls. Recomputes on: comment anchor changes, DOM mutations (debounced
 * via rAF), and window resize.
 *
 * Also returns the editor's contentDOM.scrollHeight so it stays reactive.
 */
export function useCommentPositions(
  view: EditorView | null,
  comments: CommentEntry[],
  ydoc: Y.Doc,
  ytext: Y.Text,
): CommentPositionsResult {
  const [result, setResult] = useState<CommentPositionsResult>(() => ({
    positions: new Map(),
    contentHeight: 0,
  }))
  const viewRef = useRef(view)
  viewRef.current = view

  // Rebuild the anchor list only when comment IDs change, not on
  // every comment mutation (thread reply, resolve toggle, etc.).
  const anchorsRef = useRef<AnchorKey[]>([])
  const prevIdsRef = useRef('')

  const ids = comments.map((c) => c.id).join(',')
  if (ids !== prevIdsRef.current) {
    prevIdsRef.current = ids
    anchorsRef.current = comments.map((c) => ({
      id: c.id,
      anchorStart: c.anchorStart,
      anchorEnd: c.anchorEnd,
    }))
  }

  useEffect(() => {
    const currentView = viewRef.current
    if (!currentView) {
      setResult({ positions: new Map(), contentHeight: 0 })
      return
    }

    let rafId = 0

    function compute() {
      const v = viewRef.current
      if (!v) return

      const next = new Map<string, number>()
      for (const anchor of anchorsRef.current) {
        const range = toAbsoluteCommentRange(ydoc, ytext, anchor.anchorStart, anchor.anchorEnd)
        if (!range) continue
        try {
          const block = v.lineBlockAt(range.from)
          next.set(anchor.id, block.top)
        } catch {
          // Position outside document range — skip
        }
      }
      const contentHeight = v.contentDOM.scrollHeight
      setResult({ positions: next, contentHeight })
    }

    function scheduleCompute() {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(compute)
    }

    compute()

    window.addEventListener('resize', scheduleCompute)

    const contentDOM = currentView.contentDOM
    const observer = new MutationObserver(scheduleCompute)
    observer.observe(contentDOM, { childList: true, subtree: true, characterData: true })

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', scheduleCompute)
      observer.disconnect()
    }
  }, [view, ids, ydoc, ytext])

  return result
}
