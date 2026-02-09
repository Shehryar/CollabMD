import { describe, it, expect } from 'vitest'
import type { CollabMDConfig } from './index.js'

describe('shared types', () => {
  it('CollabMDConfig accepts valid config', () => {
    const config: CollabMDConfig = {
      server: 'http://localhost:4444',
      auth: { providers: ['magic-link', 'google'] },
    }
    expect(config.server).toBe('http://localhost:4444')
    expect(config.auth?.providers).toHaveLength(2)
  })
})
