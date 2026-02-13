import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}))

vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}))

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { getCredential, saveCredential, clearCredential, type Credential } from './credentials.js'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockMkdirSync = vi.mocked(mkdirSync)
const mockChmodSync = vi.mocked(chmodSync)

const CRED_DIR = '/mock-home/.collabmd'
const CRED_FILE = '/mock-home/.collabmd/credentials.json'

const testCred: Credential = {
  sessionToken: 'sess_abc123',
  userId: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  expiresAt: '2027-12-31T00:00:00Z',
}

describe('credentials', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.COLLABMD_TOKEN
  })

  afterEach(() => {
    delete process.env.COLLABMD_TOKEN
  })

  describe('getCredential', () => {
    it('returns null when no credentials file exists', () => {
      mockExistsSync.mockReturnValue(false)

      const result = getCredential('https://app.collabmd.dev')
      expect(result).toBeNull()
    })

    it('returns stored credential for matching server URL', () => {
      const store = { 'https://app.collabmd.dev': testCred }
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify(store))

      const result = getCredential('https://app.collabmd.dev')
      expect(result).toEqual(testCred)
    })

    it('returns null for non-matching server URL', () => {
      const store = { 'https://app.collabmd.dev': testCred }
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify(store))

      const result = getCredential('https://other-server.com')
      expect(result).toBeNull()
    })

    it('returns env token when COLLABMD_TOKEN is set', () => {
      vi.stubEnv('COLLABMD_TOKEN', 'env-token-value')

      const result = getCredential('https://app.collabmd.dev')
      expect(result).toEqual({
        sessionToken: 'env-token-value',
        userId: 'env-token',
        email: '',
        name: '',
        expiresAt: '',
      })

      // Should not read the file at all
      expect(mockReadFileSync).not.toHaveBeenCalled()

      vi.unstubAllEnvs()
    })

    it('returns null when credentials file contains invalid JSON', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('not valid json{')

      const result = getCredential('https://app.collabmd.dev')
      expect(result).toBeNull()
    })

    it('returns null when credentials file is empty object', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('{}')

      const result = getCredential('https://app.collabmd.dev')
      expect(result).toBeNull()
    })
  })

  describe('saveCredential', () => {
    it('writes credential to file and sets chmod 600', () => {
      // First call: existsSync for CRED_FILE (readStore check) returns false (empty store)
      // Second call: existsSync for CRED_DIR (writeStore check) returns true
      mockExistsSync
        .mockReturnValueOnce(false) // readStore: CRED_FILE does not exist
        .mockReturnValueOnce(true) // writeStore: CRED_DIR exists

      saveCredential('https://app.collabmd.dev', testCred)

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        CRED_FILE,
        JSON.stringify({ 'https://app.collabmd.dev': testCred }, null, 2) + '\n',
      )
      expect(mockChmodSync).toHaveBeenCalledWith(CRED_FILE, 0o600)
    })

    it('creates directory if not exists', () => {
      mockExistsSync
        .mockReturnValueOnce(false) // readStore: CRED_FILE does not exist
        .mockReturnValueOnce(false) // writeStore: CRED_DIR does not exist

      saveCredential('https://app.collabmd.dev', testCred)

      expect(mockMkdirSync).toHaveBeenCalledWith(CRED_DIR, { recursive: true })
      expect(mockWriteFileSync).toHaveBeenCalled()
      expect(mockChmodSync).toHaveBeenCalledWith(CRED_FILE, 0o600)
    })

    it('preserves existing credentials for other servers', () => {
      const existingCred: Credential = {
        sessionToken: 'existing-token',
        userId: 'user-2',
        email: 'other@example.com',
        name: 'Other User',
        expiresAt: '2025-12-31T00:00:00Z',
      }
      const existingStore = { 'https://other-server.com': existingCred }

      mockExistsSync
        .mockReturnValueOnce(true) // readStore: CRED_FILE exists
        .mockReturnValueOnce(true) // writeStore: CRED_DIR exists
      mockReadFileSync.mockReturnValue(JSON.stringify(existingStore))

      saveCredential('https://app.collabmd.dev', testCred)

      const expectedStore = {
        'https://other-server.com': existingCred,
        'https://app.collabmd.dev': testCred,
      }
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        CRED_FILE,
        JSON.stringify(expectedStore, null, 2) + '\n',
      )
    })
  })

  describe('clearCredential', () => {
    it('removes credential for specific server', () => {
      const store = { 'https://app.collabmd.dev': testCred }
      mockExistsSync
        .mockReturnValueOnce(true) // readStore: CRED_FILE exists
        .mockReturnValueOnce(true) // writeStore: CRED_DIR exists
      mockReadFileSync.mockReturnValue(JSON.stringify(store))

      clearCredential('https://app.collabmd.dev')

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        CRED_FILE,
        JSON.stringify({}, null, 2) + '\n',
      )
    })

    it('handles already-empty store gracefully', () => {
      mockExistsSync
        .mockReturnValueOnce(false) // readStore: CRED_FILE does not exist (empty store)
        .mockReturnValueOnce(true) // writeStore: CRED_DIR exists

      clearCredential('https://app.collabmd.dev')

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        CRED_FILE,
        JSON.stringify({}, null, 2) + '\n',
      )
    })

    it('preserves other server credentials when clearing one', () => {
      const otherCred: Credential = {
        sessionToken: 'other-token',
        userId: 'user-2',
        email: 'other@example.com',
        name: 'Other',
        expiresAt: '2025-12-31T00:00:00Z',
      }
      const store = {
        'https://app.collabmd.dev': testCred,
        'https://other-server.com': otherCred,
      }
      mockExistsSync
        .mockReturnValueOnce(true) // readStore: CRED_FILE exists
        .mockReturnValueOnce(true) // writeStore: CRED_DIR exists
      mockReadFileSync.mockReturnValue(JSON.stringify(store))

      clearCredential('https://app.collabmd.dev')

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        CRED_FILE,
        JSON.stringify({ 'https://other-server.com': otherCred }, null, 2) + '\n',
      )
    })
  })
})
