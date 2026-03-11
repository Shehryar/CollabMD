import { describe, it, expect } from 'vitest'
import {
  users,
  documents,
  folders,
  shareLinks,
  documentSnapshots,
  jwks,
  notifications,
  userNotificationPreferences,
} from './schema.js'

describe('db schema', () => {
  it('exports all expected tables', () => {
    expect(users).toBeDefined()
    expect(documents).toBeDefined()
    expect(folders).toBeDefined()
    expect(shareLinks).toBeDefined()
    expect(documentSnapshots).toBeDefined()
    expect(jwks).toBeDefined()
    expect(notifications).toBeDefined()
    expect(userNotificationPreferences).toBeDefined()
  })
})
