import { describe, it, expect } from 'vitest'
import { sortByPosition, wouldCreateCircle } from './folder-tree-utils'
import type { Folder } from './sidebar-context'

// ── sortByPosition ────────────────────────────────────────────────────

describe('sortByPosition', () => {
  it('sorts by position ascending', () => {
    const items = [
      { id: 'c', name: 'Charlie', position: 2 },
      { id: 'a', name: 'Alpha', position: 0 },
      { id: 'b', name: 'Bravo', position: 1 },
    ]
    const sorted = sortByPosition(items, (i) => i.name)
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('uses alphabetical fallback when positions are equal', () => {
    const items = [
      { id: 'b', name: 'Bravo', position: 0 },
      { id: 'a', name: 'Alpha', position: 0 },
      { id: 'c', name: 'Charlie', position: 0 },
    ]
    const sorted = sortByPosition(items, (i) => i.name)
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('position takes precedence over alphabetical order', () => {
    const items = [
      { id: 'z', name: 'Zulu', position: 0 },
      { id: 'a', name: 'Alpha', position: 2 },
      { id: 'm', name: 'Mike', position: 1 },
    ]
    const sorted = sortByPosition(items, (i) => i.name)
    expect(sorted.map((i) => i.id)).toEqual(['z', 'm', 'a'])
  })

  it('treats missing position as 0', () => {
    const items = [
      { id: 'b', name: 'Bravo', position: 1 },
      { id: 'a', name: 'Alpha' },
    ]
    const sorted = sortByPosition(items, (i) => i.name)
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('handles empty array', () => {
    const sorted = sortByPosition([], (i: { name: string }) => i.name)
    expect(sorted).toEqual([])
  })
})

// ── wouldCreateCircle ─────────────────────────────────────────────────

function makeFolder(id: string, parentId: string | null): Folder {
  return {
    id,
    orgId: 'org-1',
    name: id,
    path: `/${id}`,
    parentId,
    position: 0,
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
  }
}

describe('wouldCreateCircle', () => {
  it('returns false when moving to root (null parent)', () => {
    const folders = [makeFolder('a', null), makeFolder('b', 'a')]
    expect(wouldCreateCircle('a', null, folders)).toBe(false)
  })

  it('returns true when moving folder into itself', () => {
    const folders = [makeFolder('a', null)]
    expect(wouldCreateCircle('a', 'a', folders)).toBe(true)
  })

  it('returns true when moving folder into its direct child', () => {
    const folders = [makeFolder('a', null), makeFolder('b', 'a')]
    expect(wouldCreateCircle('a', 'b', folders)).toBe(true)
  })

  it('returns true when moving folder into a deep descendant', () => {
    const folders = [
      makeFolder('a', null),
      makeFolder('b', 'a'),
      makeFolder('c', 'b'),
      makeFolder('d', 'c'),
    ]
    expect(wouldCreateCircle('a', 'd', folders)).toBe(true)
  })

  it('returns false for a valid move to an unrelated folder', () => {
    const folders = [makeFolder('a', null), makeFolder('b', null), makeFolder('c', 'b')]
    expect(wouldCreateCircle('a', 'c', folders)).toBe(false)
  })

  it('returns false when moving a leaf folder into a sibling', () => {
    const folders = [
      makeFolder('parent', null),
      makeFolder('a', 'parent'),
      makeFolder('b', 'parent'),
    ]
    expect(wouldCreateCircle('a', 'b', folders)).toBe(false)
  })
})
