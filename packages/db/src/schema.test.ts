import { describe, it, expect } from 'vitest'
import { users, documents, folders, shareLinks, documentSnapshots } from './schema.js'

describe('db schema', () => {
  it('exports all expected tables', () => {
    expect(users).toBeDefined()
    expect(documents).toBeDefined()
    expect(folders).toBeDefined()
    expect(shareLinks).toBeDefined()
    expect(documentSnapshots).toBeDefined()
  })
})
