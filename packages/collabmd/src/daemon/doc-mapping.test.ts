import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DocMapping } from './doc-mapping.js'

describe('DocMapping', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'collabmd-docmap-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates .collabmd directory if not exists', () => {
    const mapping = new DocMapping(tempDir)
    expect(existsSync(join(tempDir, '.collabmd'))).toBe(true)
    expect(mapping.getAllMappings()).toEqual({})
  })

  it('sets and gets doc ID', () => {
    const mapping = new DocMapping(tempDir)
    mapping.setDocId('docs/readme.md', 'uuid-1')
    expect(mapping.getDocId('docs/readme.md')).toBe('uuid-1')
  })

  it('persists across instances', () => {
    const mapping1 = new DocMapping(tempDir)
    mapping1.setDocId('notes.md', 'uuid-2')

    const mapping2 = new DocMapping(tempDir)
    expect(mapping2.getDocId('notes.md')).toBe('uuid-2')
  })

  it('removes doc mapping', () => {
    const mapping = new DocMapping(tempDir)
    mapping.setDocId('old.md', 'uuid-3')
    mapping.removeDoc('old.md')
    expect(mapping.getDocId('old.md')).toBeUndefined()
  })

  it('returns all mappings as a copy', () => {
    const mapping = new DocMapping(tempDir)
    mapping.setDocId('a.md', 'id-a')
    mapping.setDocId('b.md', 'id-b')
    const all = mapping.getAllMappings()
    expect(all).toEqual({ 'a.md': 'id-a', 'b.md': 'id-b' })

    // Verify it is a copy (mutating the returned object does not affect the mapping)
    all['c.md'] = 'id-c'
    expect(mapping.getDocId('c.md')).toBeUndefined()
  })

  it('reverse lookup by doc ID', () => {
    const mapping = new DocMapping(tempDir)
    mapping.setDocId('doc.md', 'uuid-99')
    expect(mapping.getPathForDocId('uuid-99')).toBe('doc.md')
    expect(mapping.getPathForDocId('nonexistent')).toBeUndefined()
  })

  it('overwrites existing mapping for same path', () => {
    const mapping = new DocMapping(tempDir)
    mapping.setDocId('doc.md', 'uuid-old')
    mapping.setDocId('doc.md', 'uuid-new')
    expect(mapping.getDocId('doc.md')).toBe('uuid-new')
  })

  it('handles multiple setDocId and removeDoc operations', () => {
    const mapping = new DocMapping(tempDir)
    mapping.setDocId('a.md', 'id-1')
    mapping.setDocId('b.md', 'id-2')
    mapping.setDocId('c.md', 'id-3')
    mapping.removeDoc('b.md')

    expect(mapping.getAllMappings()).toEqual({
      'a.md': 'id-1',
      'c.md': 'id-3',
    })

    // Verify persistence
    const mapping2 = new DocMapping(tempDir)
    expect(mapping2.getAllMappings()).toEqual({
      'a.md': 'id-1',
      'c.md': 'id-3',
    })
  })

  it('returns undefined for non-existent path', () => {
    const mapping = new DocMapping(tempDir)
    expect(mapping.getDocId('nonexistent.md')).toBeUndefined()
  })

  it('returns undefined for reverse lookup after removal', () => {
    const mapping = new DocMapping(tempDir)
    mapping.setDocId('doc.md', 'uuid-removed')
    mapping.removeDoc('doc.md')
    expect(mapping.getPathForDocId('uuid-removed')).toBeUndefined()
  })
})
