import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenManager } from './token-manager.js'

function makeJwt(exp: number): string {
  const header = Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'user-1', exp })).toString('base64url')
  return `${header}.${payload}.fakesignature`
}

describe('TokenManager', () => {
  const serverUrl = 'https://app.collabmd.dev'
  const sessionToken = 'sess_abc123'

  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('fetches a JWT from the server and returns it', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    const jwt = makeJwt(futureExp)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: jwt }),
    })

    const tm = new TokenManager(serverUrl, sessionToken)
    const token = await tm.getToken()

    expect(token).toBe(jwt)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('sends correct Authorization header', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600
    const jwt = makeJwt(futureExp)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: jwt }),
    })

    const tm = new TokenManager(serverUrl, sessionToken)
    await tm.getToken()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${serverUrl}/api/auth/token`,
      { headers: { Authorization: `Bearer ${sessionToken}` } },
    )
  })

  it('caches the JWT and does not re-fetch when still valid', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now (well beyond 180s threshold)
    const jwt = makeJwt(futureExp)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: jwt }),
    })

    const tm = new TokenManager(serverUrl, sessionToken)

    const token1 = await tm.getToken()
    const token2 = await tm.getToken()

    expect(token1).toBe(jwt)
    expect(token2).toBe(jwt)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1) // Only fetched once
  })

  it('re-fetches when JWT is about to expire (< 3 min remaining)', async () => {
    // First token: expires in 2 minutes (120s), which is < 180s threshold
    const soonExp = Math.floor(Date.now() / 1000) + 120
    const soonJwt = makeJwt(soonExp)

    // Second token: expires in 1 hour
    const laterExp = Math.floor(Date.now() / 1000) + 3600
    const laterJwt = makeJwt(laterExp)

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: soonJwt }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: laterJwt }),
      })

    const tm = new TokenManager(serverUrl, sessionToken)

    const token1 = await tm.getToken()
    expect(token1).toBe(soonJwt)

    // Second call should re-fetch because the cached token expires within 180s
    const token2 = await tm.getToken()
    expect(token2).toBe(laterJwt)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws on non-200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    })

    const tm = new TokenManager(serverUrl, sessionToken)
    await expect(tm.getToken()).rejects.toThrow('Failed to get JWT: 401 Unauthorized')
  })

  it('throws on 500 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    const tm = new TokenManager(serverUrl, sessionToken)
    await expect(tm.getToken()).rejects.toThrow('Failed to get JWT: 500 Internal Server Error')
  })

  it('fetches new token after previous one was near-expiry and cached new one', async () => {
    // Token that's well within validity
    const goodExp = Math.floor(Date.now() / 1000) + 7200 // 2 hours
    const goodJwt = makeJwt(goodExp)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: goodJwt }),
    })

    const tm = new TokenManager(serverUrl, sessionToken)

    // Fetch initial token
    await tm.getToken()
    // Call three more times - all should be cached
    await tm.getToken()
    await tm.getToken()
    await tm.getToken()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
