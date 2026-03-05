import crypto from 'node:crypto'

const ENCRYPTED_SECRET_PREFIX = 'enc:v1:'
const DEV_FALLBACK_KEY = 'collabmd-dev-webhook-secret-key'

function getWebhookSecretKeyMaterial(): string {
  const configured =
    process.env.COLLABMD_WEBHOOK_SECRET_KEY?.trim() || process.env.BETTER_AUTH_SECRET?.trim()
  if (configured) return configured

  if (process.env.NODE_ENV === 'production') {
    throw new Error('COLLABMD_WEBHOOK_SECRET_KEY must be configured in production')
  }

  return DEV_FALLBACK_KEY
}

function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getWebhookSecretKeyMaterial()).digest()
}

export function isEncryptedWebhookSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_SECRET_PREFIX)
}

export function encryptWebhookSecret(secret: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCRYPTED_SECRET_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptWebhookSecret(value: string): string | null {
  if (!isEncryptedWebhookSecret(value)) {
    return value
  }

  const payload = value.slice(ENCRYPTED_SECRET_PREFIX.length)
  const parts = payload.split(':')
  if (parts.length !== 3) return null
  const [ivHex, tagHex, cipherHex] = parts
  if (!ivHex || !tagHex || !cipherHex) return null

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(ivHex, 'hex'),
    )
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch {
    return null
  }
}
