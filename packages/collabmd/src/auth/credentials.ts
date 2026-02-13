import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface Credential {
  sessionToken: string
  userId: string
  email: string
  name: string
  expiresAt: string
}

const CRED_DIR = join(homedir(), '.collabmd')
const CRED_FILE = join(CRED_DIR, 'credentials.json')

type CredentialStore = Record<string, Credential>

function readStore(): CredentialStore {
  if (!existsSync(CRED_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CRED_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function writeStore(store: CredentialStore): void {
  if (!existsSync(CRED_DIR)) {
    mkdirSync(CRED_DIR, { recursive: true })
  }
  writeFileSync(CRED_FILE, JSON.stringify(store, null, 2) + '\n')
  chmodSync(CRED_FILE, 0o600)
}

export function getCredential(serverUrl: string): Credential | null {
  const envToken = process.env.COLLABMD_TOKEN
  if (envToken) {
    return {
      sessionToken: envToken,
      userId: 'env-token',
      email: '',
      name: '',
      expiresAt: '',
    }
  }
  const store = readStore()
  const cred = store[serverUrl] ?? null
  if (!cred) return null

  if (cred.expiresAt) {
    const expiresAt = Date.parse(cred.expiresAt)
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      delete store[serverUrl]
      writeStore(store)
      return null
    }
  }

  return cred
}

export function saveCredential(serverUrl: string, cred: Credential): void {
  const store = readStore()
  store[serverUrl] = cred
  writeStore(store)
}

export function clearCredential(serverUrl: string): void {
  const store = readStore()
  delete store[serverUrl]
  writeStore(store)
}
