import { describe, it, expect, afterEach } from 'vitest'
import { startLoginServer } from './login-server.js'

const activeServers: Array<{ port: number }> = []

afterEach(async () => {
  activeServers.length = 0
})

describe('LoginServer', () => {
  it('starts on a random port and resolves the port number', async () => {
    const state = 'test-state-start'
    const { port, result } = await startLoginServer(state)
    activeServers.push({ port })

    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65536)

    const res = await fetch(`http://localhost:${port}/callback?code=c&state=${state}`)
    expect(res.status).toBe(200)
    await result
  })

  it('receives callback with valid params and matching state', async () => {
    const state = 'test-state-123'
    const { port, result } = await startLoginServer(state)

    const callbackUrl = `http://localhost:${port}/callback?code=cli_code_123&state=${state}`
    const res = await fetch(callbackUrl)
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(text).toContain('Login successful')

    const loginResult = await result
    expect(loginResult.code).toBe('cli_code_123')
    expect(loginResult.state).toBe(state)
  })

  it('returns 400 on state mismatch', async () => {
    const { port } = await startLoginServer('expected-state')

    const res = await fetch(`http://localhost:${port}/callback?code=c&state=wrong-state`)
    expect(res.status).toBe(400)

    const text = await res.text()
    expect(text).toBe('State mismatch')

    await fetch(`http://localhost:${port}/callback?code=c&state=expected-state`)
  })

  it('returns 404 for non-callback paths', async () => {
    const state = 'test-state-404'
    const { port } = await startLoginServer(state)

    const res = await fetch(`http://localhost:${port}/other-path`)
    expect(res.status).toBe(404)

    const text = await res.text()
    expect(text).toBe('Not found')

    await fetch(`http://localhost:${port}/callback?code=c&state=${state}`)
  })

  it('returns 400 for missing params', async () => {
    const state = 'test-state-missing'
    const { port } = await startLoginServer(state)

    const res = await fetch(`http://localhost:${port}/callback?code=c`)
    expect(res.status).toBe(400)

    const text = await res.text()
    expect(text).toBe('Missing parameters')

    await fetch(`http://localhost:${port}/callback?code=c&state=${state}`)
  })

  it('returns 400 when code is missing', async () => {
    const state = 'test-state-no-code'
    const { port } = await startLoginServer(state)

    const res = await fetch(`http://localhost:${port}/callback?state=${state}`)
    expect(res.status).toBe(400)

    await fetch(`http://localhost:${port}/callback?code=c&state=${state}`)
  })

  it('server closes after successful callback', async () => {
    const state = 'test-state-close'
    const { port, result } = await startLoginServer(state)

    await fetch(`http://localhost:${port}/callback?code=c&state=${state}`)
    await result

    await expect(
      fetch(`http://localhost:${port}/callback`).catch(() => {
        throw new Error('connection refused')
      }),
    ).rejects.toThrow()
  })

  it('returns only the cli code and state from callback payload', async () => {
    const state = 'test-state-code-only'
    const { port, result } = await startLoginServer(state)

    await fetch(`http://localhost:${port}/callback?code=abc123&state=${state}`)

    const loginResult = await result
    expect(loginResult).toEqual({ code: 'abc123', state })
  })
})
