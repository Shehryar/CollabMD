import { describe, expect, it } from 'vitest'
import { computePopoverPosition } from './comment-popover-position'

// Constants mirrored from comment-input.tsx
const POPOVER_WIDTH = 384
const VIEWPORT_PADDING = 12
const ARROW_SIZE = 8
const ARROW_MIN = ARROW_SIZE + 4
const ARROW_MAX = POPOVER_WIDTH - ARROW_SIZE - 4

const VIEWPORT = { width: 1280, height: 800 }

describe('computePopoverPosition', () => {
  describe('horizontal clamping', () => {
    it('centers popover on the anchor when there is room', () => {
      const result = computePopoverPosition({ left: 640, top: 300 }, VIEWPORT, 200)
      // 640 - 384/2 = 448
      expect(result.left).toBe(448)
    })

    it('clamps left edge so popover never goes below VIEWPORT_PADDING', () => {
      // Anchor near left edge: left=20, idealLeft = 20 - 192 = -172
      const result = computePopoverPosition({ left: 20, top: 300 }, VIEWPORT, 200)
      expect(result.left).toBe(VIEWPORT_PADDING)
      expect(result.left).toBeGreaterThanOrEqual(0)
    })

    it('clamps right edge so popover never overflows viewport', () => {
      // Anchor near right edge: left=1270, idealLeft = 1270 - 192 = 1078
      // max = 1280 - 384 - 12 = 884
      const result = computePopoverPosition({ left: 1270, top: 300 }, VIEWPORT, 200)
      expect(result.left).toBe(VIEWPORT.width - POPOVER_WIDTH - VIEWPORT_PADDING)
      expect(result.left + POPOVER_WIDTH + VIEWPORT_PADDING).toBeLessThanOrEqual(VIEWPORT.width)
    })

    it('handles anchor at x=0', () => {
      const result = computePopoverPosition({ left: 0, top: 300 }, VIEWPORT, 200)
      expect(result.left).toBe(VIEWPORT_PADDING)
    })

    it('handles anchor at viewport right boundary', () => {
      const result = computePopoverPosition({ left: VIEWPORT.width, top: 300 }, VIEWPORT, 200)
      expect(result.left + POPOVER_WIDTH).toBeLessThanOrEqual(VIEWPORT.width)
    })
  })

  describe('vertical positioning and flipping', () => {
    it('positions below the anchor by default', () => {
      const result = computePopoverPosition({ left: 640, top: 200 }, VIEWPORT, 180)
      expect(result.flipped).toBe(false)
      expect(result.top).toBe(200 + ARROW_SIZE)
    })

    it('flips above when there is not enough space below', () => {
      // anchor.top = 700, popoverHeight = 200, spaceBelow = 800 - 700 = 100
      // need: 200 + 12 + 8 = 220 > 100 => flip
      const result = computePopoverPosition({ left: 640, top: 700 }, VIEWPORT, 200)
      expect(result.flipped).toBe(true)
      expect(result.top).toBeLessThan(700)
    })

    it('does not flip when there is just enough room below', () => {
      // spaceBelow needs >= height + VIEWPORT_PADDING + ARROW_SIZE = 200 + 12 + 8 = 220
      // anchor.top = 800 - 220 = 580
      const result = computePopoverPosition({ left: 640, top: 580 }, VIEWPORT, 200)
      expect(result.flipped).toBe(false)
    })

    it('flipped top never goes below VIEWPORT_PADDING', () => {
      // anchor near top + flip scenario: very short viewport
      const tinyViewport = { width: 1280, height: 100 }
      const result = computePopoverPosition({ left: 640, top: 90 }, tinyViewport, 200)
      if (result.flipped) {
        expect(result.top).toBeGreaterThanOrEqual(VIEWPORT_PADDING)
      }
    })

    it('positions at anchor.top + ARROW_SIZE when not flipped', () => {
      const anchor = { left: 500, top: 250 }
      const result = computePopoverPosition(anchor, VIEWPORT, 150)
      expect(result.flipped).toBe(false)
      expect(result.top).toBe(anchor.top + ARROW_SIZE)
    })
  })

  describe('arrow positioning', () => {
    it('arrow points at the anchor left when popover is centered', () => {
      const result = computePopoverPosition({ left: 640, top: 300 }, VIEWPORT, 200)
      // popover.left = 448, arrowLeft = 640 - 448 = 192 (center of popover)
      expect(result.arrowLeft).toBe(640 - result.left)
    })

    it('arrow clamps to minimum when anchor is far left of popover', () => {
      // anchor at left edge, popover starts at VIEWPORT_PADDING
      const result = computePopoverPosition({ left: 5, top: 300 }, VIEWPORT, 200)
      // anchor.left - left = 5 - 12 = -7, clamped to ARROW_MIN
      expect(result.arrowLeft).toBe(ARROW_MIN)
    })

    it('arrow clamps to maximum when anchor is far right of popover', () => {
      // anchor at right edge, popover ends before viewport edge
      const result = computePopoverPosition({ left: VIEWPORT.width - 2, top: 300 }, VIEWPORT, 200)
      expect(result.arrowLeft).toBeLessThanOrEqual(ARROW_MAX)
    })

    it('arrow stays within popover bounds', () => {
      const testCases = [
        { left: 0, top: 300 },
        { left: 50, top: 300 },
        { left: 640, top: 300 },
        { left: 1200, top: 300 },
        { left: 1280, top: 300 },
      ]
      for (const anchor of testCases) {
        const result = computePopoverPosition(anchor, VIEWPORT, 200)
        expect(result.arrowLeft).toBeGreaterThanOrEqual(ARROW_MIN)
        expect(result.arrowLeft).toBeLessThanOrEqual(ARROW_MAX)
      }
    })
  })

  describe('edge cases', () => {
    it('uses estimated height when popoverHeight is undefined', () => {
      const withEstimate = computePopoverPosition({ left: 640, top: 300 }, VIEWPORT)
      const withExplicit = computePopoverPosition({ left: 640, top: 300 }, VIEWPORT, 200)
      expect(withEstimate).toEqual(withExplicit)
    })

    it('handles very small viewport', () => {
      const tiny = { width: 200, height: 200 }
      const result = computePopoverPosition({ left: 100, top: 100 }, tiny, 150)
      expect(result.left).toBeGreaterThanOrEqual(0)
      expect(result.top).toBeGreaterThanOrEqual(0)
    })

    it('handles zero-size viewport gracefully', () => {
      const result = computePopoverPosition({ left: 0, top: 0 }, { width: 0, height: 0 }, 100)
      expect(result.left).toBe(VIEWPORT_PADDING)
      expect(result.top).toBeGreaterThanOrEqual(0)
    })

    it('selection near bottom-left corner flips and clamps left', () => {
      const result = computePopoverPosition({ left: 10, top: 790 }, VIEWPORT, 200)
      expect(result.flipped).toBe(true)
      expect(result.left).toBe(VIEWPORT_PADDING)
      expect(result.top).toBeLessThan(790)
    })

    it('selection near bottom-right corner flips and clamps right', () => {
      const result = computePopoverPosition({ left: 1270, top: 790 }, VIEWPORT, 200)
      expect(result.flipped).toBe(true)
      expect(result.left + POPOVER_WIDTH + VIEWPORT_PADDING).toBeLessThanOrEqual(VIEWPORT.width)
      expect(result.top).toBeLessThan(790)
    })

    it('popover stays fully within viewport in all corners', () => {
      const corners = [
        { left: 0, top: 0 },
        { left: VIEWPORT.width, top: 0 },
        { left: 0, top: VIEWPORT.height },
        { left: VIEWPORT.width, top: VIEWPORT.height },
      ]
      for (const anchor of corners) {
        const result = computePopoverPosition(anchor, VIEWPORT, 180)
        expect(result.left).toBeGreaterThanOrEqual(0)
        expect(result.top).toBeGreaterThanOrEqual(0)
        // The popover right edge should be within viewport (with some tolerance for the arrow)
        expect(result.left + POPOVER_WIDTH).toBeLessThanOrEqual(VIEWPORT.width)
      }
    })
  })
})
