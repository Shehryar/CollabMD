import { describe, expect, it } from 'vitest'
import { computeCommentLayout, type LayoutInput } from './comment-layout'

function toMap(layout: ReturnType<typeof computeCommentLayout>): Map<string, number> {
  return new Map(layout.map((entry) => [entry.id, entry.y]))
}

describe('computeCommentLayout', () => {
  it('returns empty for no items', () => {
    expect(computeCommentLayout([], null)).toEqual([])
  })

  it('keeps non-overlapping cards at their ideal positions', () => {
    const input: LayoutInput[] = [
      { id: 'a', idealY: 10, height: 20 },
      { id: 'b', idealY: 40, height: 20 },
      { id: 'c', idealY: 70, height: 16 },
    ]

    expect(computeCommentLayout(input, null)).toEqual([
      { id: 'a', y: 10 },
      { id: 'b', y: 40 },
      { id: 'c', y: 70 },
    ])
  })

  it('pushes overlapping cards downward with the minimum gap', () => {
    const input: LayoutInput[] = [
      { id: 'a', idealY: 10, height: 20 },
      { id: 'b', idealY: 15, height: 10 },
      { id: 'c', idealY: 26, height: 10 },
    ]

    expect(computeCommentLayout(input, null)).toEqual([
      { id: 'a', y: 10 },
      { id: 'b', y: 36 },
      { id: 'c', y: 52 },
    ])
  })

  it('prioritizes the active card and resolves neighbors around it', () => {
    const input: LayoutInput[] = [
      { id: 'c', idealY: 35, height: 20 },
      { id: 'a', idealY: 10, height: 20 },
      { id: 'b', idealY: 30, height: 20 },
    ]

    const map = toMap(computeCommentLayout(input, 'b'))
    expect(map.get('b')).toBe(30)
    expect(map.get('a')).toBe(4)
    expect(map.get('c')).toBe(56)
  })

  it('keeps spacing valid when cards above active clamp at y=0', () => {
    const input: LayoutInput[] = [
      { id: 'top', idealY: 0, height: 20 },
      { id: 'active', idealY: 5, height: 20 },
      { id: 'below', idealY: 8, height: 20 },
    ]

    const map = toMap(computeCommentLayout(input, 'active'))
    expect(map.get('top')).toBe(0)
    expect(map.get('active')).toBe(26)
    expect(map.get('below')).toBe(52)
  })
})
