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

  saveCredential(serverUrl, {
    sessionToken: loginResult.token,
    userId: loginResult.userId,
    email: loginResult.email,
    name: loginResult.name,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  console.log(`Logged in as ${loginResult.email}`)
}
