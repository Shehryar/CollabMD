import crypto from 'node:crypto'

interface CliAuthCodeRecord {
  code: string
  sessionToken: string
  userId: string
  email: string
  name: string
  expiresAt: number
}

const CLI_AUTH_TTL_MS = 60_000
const cliAuthCodes = new Map<string, CliAuthCodeRecord>()

setInterval(() => {
  const now = Date.now()
  for (const [code, record] of cliAuthCodes) {
    if (record.expiresAt <= now) {
      cliAuthCodes.delete(code)
    }
  }
}).unref()

export function createCliAuthCode(input: {
  sessionToken: string
  userId: string
  email: string
  name: string
}): CliAuthCodeRecord {
  const code = crypto.randomBytes(24).toString('base64url')
  const record: CliAuthCodeRecord = {
    code,
    sessionToken: input.sessionToken,
    userId: input.userId,
    email: input.email,
    name: input.name,
    expiresAt: Date.now() + CLI_AUTH_TTL_MS,
  }
  cliAuthCodes.set(code, record)
  return record
}

export function consumeCliAuthCode(code: string): CliAuthCodeRecord | null {
  const record = cliAuthCodes.get(code)
  if (!record) return null
  cliAuthCodes.delete(code)
  if (record.expiresAt <= Date.now()) return null
  return record
}

export function resetCliAuthCodes(): void {
  cliAuthCodes.clear()
}
