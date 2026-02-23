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
      serverUrl: 'http://localhost:3000',
    })

    const output = String(logSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('"command": "npx"')
    expect(output).toContain('"COLLABMD_API_KEY": "<set-your-agent-api-key>"')
    expect(output).not.toContain('ak_super_secret')
    expect(errorSpy).toHaveBeenCalledWith(
      'Warning: --api-key is not embedded in output to avoid leaking secrets. Set COLLABMD_API_KEY in the MCP env block.',
    )
  })

  it('uses default local server url when not provided', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mcpConfigCommand({})

    const output = String(logSpy.mock.calls[0]?.[0] ?? '')
    expect(output).toContain('"--server-url"')
    expect(output).toContain('"http://localhost:3000"')
  })
})
