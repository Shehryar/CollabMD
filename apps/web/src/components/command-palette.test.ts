// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { filterCommandItems } from '@/lib/keyboard-shortcuts'

const sampleItems = [
  { id: 'doc-1', label: 'Getting Started Guide', category: 'documents', action: () => {} },
  { id: 'doc-2', label: 'API Reference', category: 'documents', action: () => {} },
  { id: 'doc-3', label: 'Architecture Notes', category: 'documents', action: () => {} },
  {
    id: 'action-sidebar',
    label: 'Toggle sidebar',
    category: 'actions',
    shortcut: '\u2318\\',
    action: () => {},
  },
  {
    id: 'action-share',
    label: 'Share document',
    category: 'actions',
    shortcut: '\u2318\u21E7S',
    action: () => {},
  },
  {
    id: 'action-history',
    label: 'Version history',
    category: 'actions',
    shortcut: '\u2318\u21E7H',
    action: () => {},
  },
]

describe('filterCommandItems', () => {
  it('returns all items when query is empty', () => {
    const result = filterCommandItems(sampleItems, '')
    expect(result).toHaveLength(sampleItems.length)
  })

  it('returns all items when query is whitespace', () => {
    const result = filterCommandItems(sampleItems, '   ')
    expect(result).toHaveLength(sampleItems.length)
  })

  it('filters by document title', () => {
    const result = filterCommandItems(sampleItems, 'getting')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('doc-1')
  })

  it('filters case-insensitively', () => {
    const result = filterCommandItems(sampleItems, 'API')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('doc-2')
  })

  it('filters action names', () => {
    const result = filterCommandItems(sampleItems, 'sidebar')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('action-sidebar')
  })

  it('returns multiple matches', () => {
    const result = filterCommandItems(sampleItems, 'ar')
    // "Share document" and "Architecture Notes" both contain "ar"
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('returns empty array when nothing matches', () => {
    const result = filterCommandItems(sampleItems, 'zzzzz')
    expect(result).toHaveLength(0)
  })

  it('matches partial strings', () => {
    const result = filterCommandItems(sampleItems, 'hist')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('action-history')
  })

  it('matches across categories', () => {
    const result = filterCommandItems(sampleItems, 'version')
    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('actions')
  })
})
