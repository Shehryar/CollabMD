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
