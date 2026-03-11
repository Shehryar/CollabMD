import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mcpConfigCommand } from './mcp.js'

describe('mcpConfigCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('prints env-based config without inline api key', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mcpConfigCommand({
      apiKey: 'ak_super_secret',
      baseUrl: 'http://localhost:3000',
    })

    const output = String(logSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('"command": "pnpm"')
    expect(output).toContain('"collabmd"')
    expect(output).toContain('"mcp"')
    expect(output).toContain('"--api-key"')
    expect(output).toContain('"<set-your-agent-api-key>"')
    expect(output).toContain('"--base-url"')
    expect(output).not.toContain('ak_super_secret')
    expect(errorSpy).toHaveBeenCalledWith(
      'Warning: --api-key is not embedded verbatim in output. Replace <set-your-agent-api-key> before using the config snippet.',
    )
  })

  it('uses default local server url when not provided', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mcpConfigCommand({})

    const output = String(logSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('"--base-url"')
    expect(output).toContain('"http://localhost:3000"')
  })
})
