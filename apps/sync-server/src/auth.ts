import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const authUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
const JWKS = createRemoteJWKSet(new URL(`${authUrl}/api/auth/jwks`))

export interface TokenPayload extends JWTPayload {
  id: string
  email: string
  name?: string
  activeOrganizationId?: string
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: authUrl,
      audience: authUrl,
    })
    return payload as TokenPayload
  } catch {
    return null
  }
}

export async function verifySessionCookie(cookieHeader: string): Promise<TokenPayload | null> {
  try {
    const res = await fetch(`${authUrl}/api/auth/get-session`, {
      headers: {
        cookie: cookieHeader,
      },
    })
    if (!res.ok) return null

    const data = (await res.json()) as {
      user?: { id?: string; email?: string; name?: string }
      session?: { activeOrganizationId?: string }
    }
    if (!data.user?.id || !data.user.email) return null

    return {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      activeOrganizationId: data.session?.activeOrganizationId,
    }
  } catch {
    return null
  }
}
