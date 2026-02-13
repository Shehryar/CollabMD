export class TokenManager {
  private serverUrl: string
  private sessionToken: string
  private cachedJwt: string | null = null
  private jwtExpiresAt: number = 0

  constructor(serverUrl: string, sessionToken: string) {
    this.serverUrl = serverUrl
    this.sessionToken = sessionToken
  }

  async getToken(): Promise<string> {
    const now = Date.now() / 1000
    if (this.cachedJwt && this.jwtExpiresAt - now > 180) {
      return this.cachedJwt
    }

    const res = await fetch(`${this.serverUrl}/api/auth/token`, {
      headers: { Authorization: `Bearer ${this.sessionToken}` },
    })

    if (!res.ok) {
      throw new Error(`Failed to get JWT: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as { token: string }
    this.cachedJwt = data.token

    const payload = JSON.parse(
      Buffer.from(data.token.split('.')[1], 'base64url').toString(),
    ) as { exp: number }
    this.jwtExpiresAt = payload.exp

    return data.token
  }
}
