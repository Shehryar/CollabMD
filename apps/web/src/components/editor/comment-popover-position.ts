export const POPOVER_WIDTH = 384
export const POPOVER_ESTIMATED_HEIGHT = 200
export const VIEWPORT_PADDING = 12
export const ARROW_SIZE = 8

export interface PopoverPosition {
  left: number
  top: number
  flipped: boolean
  arrowLeft: number
}

/**
 * Compute a viewport-clamped position for the comment popover.
 *
 * - Horizontally centers on `anchor.left`, clamped so the popover never
 *   overflows left or right viewport edges.
 * - Prefers positioning below the anchor; flips above if there is
 *   insufficient space below.
 * - Returns an `arrowLeft` offset (relative to the popover) that
 *   points back at the original anchor.
 */
export function computePopoverPosition(
  anchor: { left: number; top: number },
  viewport: { width: number; height: number },
  popoverHeight?: number,
): PopoverPosition {
  const height = popoverHeight ?? POPOVER_ESTIMATED_HEIGHT

  // Horizontal: center the popover on the anchor, then clamp to viewport
  const idealLeft = anchor.left - POPOVER_WIDTH / 2
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(idealLeft, viewport.width - POPOVER_WIDTH - VIEWPORT_PADDING),
  )

  // Arrow points at the original anchor.left, offset relative to the popover left
  const arrowMin = ARROW_SIZE + 4
  const arrowMax = POPOVER_WIDTH - ARROW_SIZE - 4
  const arrowLeft = Math.max(arrowMin, Math.min(anchor.left - left, arrowMax))

  // Vertical: prefer below the anchor. Flip above if it would overflow.
  const spaceBelow = viewport.height - anchor.top
  const flipped = spaceBelow < height + VIEWPORT_PADDING + ARROW_SIZE
  const top = flipped
    ? Math.max(VIEWPORT_PADDING, anchor.top - height - ARROW_SIZE - 8)
    : anchor.top + ARROW_SIZE

  return { left, top, flipped, arrowLeft }
}
