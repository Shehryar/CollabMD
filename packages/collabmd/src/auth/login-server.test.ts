import { describe, it, expect, afterEach } from 'vitest'
import { startLoginServer } from './login-server.js'

// Track servers to ensure cleanup
const activeServers: Array<{ port: number }> = []

afterEach(async () => {
  // Force-close any lingering servers by hitting them with correct state
  // (the server auto-closes on success, and the 120s timeout handles failure)
  activeServers.length = 0
})

describe('LoginServer', () => {
  it('starts on a random port and resolves the port number', async () => {
    const state = 'test-state-start'
    const { port, result } = await startLoginServer(state)
    activeServers.push({ port })

    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65536)

    // Clean up: send valid callback to close the server
    const res = await fetch(
      `http://localhost:${port}/callback?token=t&state=${state}&userId=u&email=e@e.com`,
    )
    expect(res.status).toBe(200)
    await result
  })

  it('receives callback with valid params and matching state', async () => {
    const state = 'test-state-123'
    const { port, result } = await startLoginServer(state)

    const callbackUrl = `http://localhost:${port}/callback?token=sess_abc&state=${state}&userId=user-1&email=test@example.com&name=Test+User`
    const res = await fetch(callbackUrl)
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(text).toContain('Login successful')

    const loginResult = await result
    expect(loginResult.token).toBe('sess_abc')
    expect(loginResult.state).toBe(state)
    expect(loginResult.userId).toBe('user-1')
    expect(loginResult.email).toBe('test@example.com')
    expect(loginResult.name).toBe('Test User')
  })

  it('returns 400 on state mismatch', async () => {
    const { port } = await startLoginServer('expected-state')

    const res = await fetch(
      `http://localhost:${port}/callback?token=t&state=wrong-state&userId=u&email=e@e.com`,
    )
    expect(res.status).toBe(400)

    const text = await res.text()
    expect(text).toBe('State mismatch')

    // Clean up: send correct state to close server
    await fetch(
      `http://localhost:${port}/callback?token=t&state=expected-state&userId=u&email=e@e.com`,
    )
  })

  it('returns 404 for non-callback paths', async () => {
    const state = 'test-state-404'
    const { port } = await startLoginServer(state)

    const res = await fetch(`http://localhost:${port}/other-path`)
    expect(res.status).toBe(404)

    const text = await res.text()
    expect(text).toBe('Not found')

    // Clean up
    await fetch(`http://localhost:${port}/callback?token=t&state=${state}&userId=u&email=e@e.com`)
  })

  it('returns 400 for missing params (no state, userId, email)', async () => {
    const state = 'test-state-missing'
    const { port } = await startLoginServer(state)

    const res = await fetch(`http://localhost:${port}/callback?token=t`)
    expect(res.status).toBe(400)

    const text = await res.text()
    expect(text).toBe('Missing parameters')

    // Clean up
    await fetch(`http://localhost:${port}/callback?token=t&state=${state}&userId=u&email=e@e.com`)
  })

  it('returns 400 when token is missing', async () => {
    const state = 'test-state-no-token'
    const { port } = await startLoginServer(state)

    const res = await fetch(
      `http://localhost:${port}/callback?state=${state}&userId=u&email=e@e.com`,
    )
    expect(res.status).toBe(400)

    // Clean up
    await fetch(`http://localhost:${port}/callback?token=t&state=${state}&userId=u&email=e@e.com`)
  })

  it('server closes after successful callback', async () => {
    const state = 'test-state-close'
    const { port, result } = await startLoginServer(state)

    await fetch(`http://localhost:${port}/callback?token=t&state=${state}&userId=u&email=e@e.com`)
    await result

    // Server should be closed now; next request should fail
    await expect(
      fetch(`http://localhost:${port}/callback`).catch(() => {
        throw new Error('connection refused')
      }),
    ).rejects.toThrow()
  })

  it('handles callback with no name parameter (defaults to empty string)', async () => {
    const state = 'test-state-no-name'
    const { port, result } = await startLoginServer(state)

    await fetch(`http://localhost:${port}/callback?token=t&state=${state}&userId=u&email=e@e.com`)

    const loginResult = await result
    expect(loginResult.name).toBe('')
  })
})
