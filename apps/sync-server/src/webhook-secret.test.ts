import { afterEach, describe, expect, it } from 'vitest'
import { decryptWebhookSecret, encryptWebhookSecret, isEncryptedWebhookSecret } from './webhook-secret.js'

describe('decryptWebhookSecret', () => {
  afterEach(() => {
    delete process.env.COLLABMD_WEBHOOK_SECRET_KEY
  })

  it('supports encrypted secrets', () => {
    process.env.COLLABMD_WEBHOOK_SECRET_KEY = 'sync-server-test-key'
    const encrypted = encryptWebhookSecret('raw-secret')
    expect(isEncryptedWebhookSecret(encrypted)).toBe(true)
    expect(decryptWebhookSecret(encrypted)).toBe('raw-secret')
  })

  it('supports legacy plaintext secrets', () => {
    expect(decryptWebhookSecret('legacy-secret')).toBe('legacy-secret')
  })

  it('returns null for malformed encrypted payloads', () => {
    expect(decryptWebhookSecret('enc:v1:not-valid')).toBeNull()
  })
})
