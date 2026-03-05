/**
 * Pure collision resolution for vertically-anchored comment cards.
 *
 * Given a list of cards with ideal Y positions and measured heights,
 * resolves overlaps by pushing cards down with a minimum gap.
 */

const MIN_GAP = 6

export interface LayoutInput {
  id: string
  idealY: number
  height: number
}

export interface LayoutOutput {
  id: string
  y: number
}

export function computeCommentLayout(
  items: LayoutInput[],
  activeId: string | null,
): LayoutOutput[] {
  if (items.length === 0) return []

  // Sort by idealY ascending
  const sorted = [...items].sort((a, b) => a.idealY - b.idealY)

  // If there's an active comment, give it priority placement at its ideal Y.
  // Then resolve neighbors around it.
  if (activeId) {
    const activeIndex = sorted.findIndex((item) => item.id === activeId)
    if (activeIndex >= 0) {
      return resolveWithPriority(sorted, activeIndex)
    }
  }

  // Simple top-to-bottom walk
  return resolveTopDown(sorted)
}

function resolveTopDown(sorted: LayoutInput[]): LayoutOutput[] {
  const result: LayoutOutput[] = []
  let bottomEdge = -Infinity

  for (const item of sorted) {
    const y = Math.max(item.idealY, bottomEdge)
    result.push({ id: item.id, y })
    bottomEdge = y + item.height + MIN_GAP
  }

  return result
}

function resolveWithPriority(sorted: LayoutInput[], activeIndex: number): LayoutOutput[] {
  const result: LayoutOutput[] = new Array(sorted.length)

  // Place active card at its ideal position
  const active = sorted[activeIndex]!
  result[activeIndex] = { id: active.id, y: active.idealY }

  // Resolve cards below the active card (top-to-bottom)
  let bottomEdge = active.idealY + active.height + MIN_GAP
  for (let i = activeIndex + 1; i < sorted.length; i++) {
    const item = sorted[i]!
    const y = Math.max(item.idealY, bottomEdge)
    result[i] = { id: item.id, y }
    bottomEdge = y + item.height + MIN_GAP
  }

  // Resolve cards above the active card (bottom-to-top)
  let topEdge = active.idealY - MIN_GAP
  for (let i = activeIndex - 1; i >= 0; i--) {
    const item = sorted[i]!
    const y = Math.min(item.idealY, topEdge - item.height)
    result[i] = { id: item.id, y: Math.max(0, y) }
    topEdge = Math.max(0, y) - MIN_GAP
  }

  // Fix overlap caused by clamping at y=0: forward pass to push down
  let edge = 0
  for (let i = 0; i < activeIndex; i++) {
    const item = sorted[i]!
    if (result[i]!.y < edge) {
      result[i] = { id: item.id, y: edge }
    }
    edge = result[i]!.y + item.height + MIN_GAP
  }

  // If clamping above items to y=0 forced them into the active card's space,
  // shift the active card (and cards below it) down to keep spacing valid.
  if (activeIndex > 0) {
    const prev = sorted[activeIndex - 1]!
    const minActiveY = result[activeIndex - 1]!.y + prev.height + MIN_GAP
    const activeY = result[activeIndex]!.y
    if (activeY < minActiveY) {
      result[activeIndex] = { id: active.id, y: minActiveY }

      let nextBottom = minActiveY + active.height + MIN_GAP
      for (let i = activeIndex + 1; i < sorted.length; i++) {
        const item = sorted[i]!
        const y = Math.max(item.idealY, nextBottom)
        result[i] = { id: item.id, y }
        nextBottom = y + item.height + MIN_GAP
      }
    }
  }

  return result
}
