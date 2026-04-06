import { randomBytes } from 'crypto'
import open from 'open'
import { startLoginServer } from '../auth/login-server.js'
import { saveCredential } from '../auth/credentials.js'

export async function loginCommand(serverUrl: string): Promise<void> {
  const state = randomBytes(16).toString('hex')
  const { port, result } = await startLoginServer(state)

  const callbackUrl = `${serverUrl}/api/auth/cli-callback?port=${port}&state=${state}`
  console.log('Opening browser for login...')
  console.log(`If browser doesn't open, visit: ${callbackUrl}`)
  await open(callbackUrl)

  const loginResult = await result

  const exchangeRes = await fetch(`${serverUrl}/api/auth/cli-exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: loginResult.code }),
  })

  if (!exchangeRes.ok) {
    throw new Error(`Failed to exchange CLI login code: ${exchangeRes.status} ${exchangeRes.statusText}`)
  }

  const exchanged = (await exchangeRes.json()) as {
    token: string
    userId: string
    email: string
    name: string
  }

  saveCredential(serverUrl, {
    sessionToken: exchanged.token,
    userId: exchanged.userId,
    email: exchanged.email,
    name: exchanged.name,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  console.log(`Logged in as ${exchanged.email}`)
}
