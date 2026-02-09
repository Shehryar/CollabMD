import { describe, it, expect } from 'vitest'
import { defineConfig, defaultConfig } from './config.js'

describe('defineConfig', () => {
  it('returns defaults when called with no args', () => {
    const config = defineConfig()
    expect(config.server).toBe('http://localhost:3000')
    expect(config.database.engine).toBe('sqlite')
    expect(config.permissions.engine).toBe('openfga')
  })

  it('merges user overrides', () => {
    const config = defineConfig({
      server: 'https://collabmd.dev',
      database: { engine: 'postgres', url: 'postgres://localhost:5432/collabmd' },
    })
    expect(config.server).toBe('https://collabmd.dev')
    expect(config.database.engine).toBe('postgres')
    expect(config.permissions.engine).toBe('openfga')
  })

  it('defaultConfig has all required fields', () => {
    expect(defaultConfig.server).toBeDefined()
    expect(defaultConfig.database).toBeDefined()
    expect(defaultConfig.permissions).toBeDefined()
    expect(defaultConfig.email).toBeDefined()
    expect(defaultConfig.storage).toBeDefined()
  })
})
