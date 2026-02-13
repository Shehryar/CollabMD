import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const questionMock = vi.fn<(_message: string) => Promise<string>>()
const closeMock = vi.fn()

vi.mock('readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: questionMock,
    close: closeMock,
  })),
}))

vi.mock('../auth/index.js', () => ({
  getCredential: vi.fn(),
  saveCredential: vi.fn(),
  startLoginServer: vi.fn(),
}))

import { getCredential, saveCredential, startLoginServer } from '../auth/index.js'
import { runOnboardingFlow } from './onboarding.js'

const mockGetCredential = vi.mocked(getCredential)
const mockSaveCredential = vi.mocked(saveCredential)
const mockStartLoginServer = vi.mocked(startLoginServer)

describe('runOnboardingFlow', () => {
  let rootDir: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    questionMock.mockResolvedValue('')
    mockGetCredential.mockReturnValue(null)
    rootDir = mkdtempSync(join(tmpdir(), 'collabmd-onboarding-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('creates scaffold in local mode and ignores excluded markdown paths when scanning', async () => {
    const projectDir = join(rootDir, 'workspace')
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(join(projectDir, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(projectDir, '.git'), { recursive: true })
    mkdirSync(join(projectDir, '.collabmd'), { recursive: true })
    mkdirSync(join(projectDir, 'docs'), { recursive: true })
    writeFileSync(join(projectDir, 'docs', 'welcome.md'), '# Welcome\n')
    writeFileSync(join(projectDir, 'keep.md'), '# Keep\n')
    writeFileSync(join(projectDir, 'node_modules', 'pkg', 'ignored.md'), '# Ignore\n')
    writeFileSync(join(projectDir, '.git', 'ignored.md'), '# Ignore\n')
    writeFileSync(join(projectDir, '.collabmd', 'ignored.md'), '# Ignore\n')

    await runOnboardingFlow({
      cwdMode: true,
      rootDir: projectDir,
      argv: ['--skip=server,auth,workspace,invite,background'],
    })

    expect(existsSync(join(projectDir, 'collabmd.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'COLLABMD.md'))).toBe(true)
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Found 3 markdown files'))
  })

  it('handles auth timeout and continues without credentials', async () => {
    vi.useFakeTimers()
    mockStartLoginServer.mockResolvedValue({
      port: 4242,
      result: new Promise(() => {}),
    })

    const flow = runOnboardingFlow({
      rootDir,
      argv: ['project', '--skip=workspace,invite,scan,background'],
      defaultServerUrl: 'https://collabmd.dev',
      openBrowser: vi.fn(async () => {}),
    })

    await vi.advanceTimersByTimeAsync(60_001)
    await flow

    expect(errorSpy).toHaveBeenCalledWith('Authentication timed out after 60 seconds; skipping auth.')
    expect(mockSaveCredential).not.toHaveBeenCalled()
  })

  it('selects an existing workspace from organization list', async () => {
    mockGetCredential.mockReturnValue({
      sessionToken: 'token-1',
      userId: 'u-1',
      email: 'a@b.com',
      name: 'Ada',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    questionMock.mockResolvedValueOnce('1')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'org-1', name: 'Workspace A' }],
    })

    await runOnboardingFlow({
      rootDir,
      argv: ['project', '--skip=invite,scan,background'],
      defaultServerUrl: 'https://collabmd.dev',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const config = JSON.parse(readFileSync(join(rootDir, 'project', 'collabmd.json'), 'utf-8')) as { orgId?: string }
    expect(config.orgId).toBe('org-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://collabmd.dev/api/auth/organization/list',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    )
  })

  it('creates a new workspace when user chooses new', async () => {
    mockGetCredential.mockReturnValue({
      sessionToken: 'token-2',
      userId: 'u-2',
      email: 'new@b.com',
      name: 'New User',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    questionMock
      .mockResolvedValueOnce('new')
      .mockResolvedValueOnce('Team Docs')

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'org-old', name: 'Old Org' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'org-new' }),
      })

    await runOnboardingFlow({
      rootDir,
      argv: ['project', '--skip=invite,scan,background'],
      defaultServerUrl: 'https://collabmd.dev',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const createCall = fetchMock.mock.calls[1]
    expect(createCall?.[0]).toBe('https://collabmd.dev/api/auth/organization/create')
    expect(createCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Team Docs' }),
    }))
    const config = JSON.parse(readFileSync(join(rootDir, 'project', 'collabmd.json'), 'utf-8')) as { orgId?: string }
    expect(config.orgId).toBe('org-new')
  })

  it('parses comma-separated invite emails and sends one invite per email', async () => {
    mockGetCredential.mockReturnValue({
      sessionToken: 'token-3',
      userId: 'u-3',
      email: 'invite@b.com',
      name: 'Inviter',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    questionMock.mockResolvedValueOnce('a@x.com, b@y.com, , c@z.com ')

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })

    await runOnboardingFlow({
      rootDir,
      argv: ['project', '--skip=workspace,scan,background'],
      defaultServerUrl: 'https://collabmd.dev',
      defaultOrgId: 'org-123',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body?: string }).body ?? '{}') as { email?: string })
    expect(bodies.map((body) => body.email)).toEqual(['a@x.com', 'b@y.com', 'c@z.com'])
  })

  it('offers retry/skip on workspace network failure and skips when chosen', async () => {
    mockGetCredential.mockReturnValue({
      sessionToken: 'token-4',
      userId: 'u-4',
      email: 'retry@b.com',
      name: 'Retry',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    questionMock.mockResolvedValueOnce('s')
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))

    await runOnboardingFlow({
      rootDir,
      argv: ['project', '--skip=invite,scan,background'],
      defaultServerUrl: 'https://collabmd.dev',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const config = JSON.parse(readFileSync(join(rootDir, 'project', 'collabmd.json'), 'utf-8')) as { orgId?: string }
    expect(config.orgId).toBeUndefined()
    expect(questionMock).toHaveBeenCalledWith(expect.stringContaining('Could not reach server at https://collabmd.dev. Check your connection. Retry or skip? (r/S) [s] '))
  })

  it('supports full skip combinations and avoids interactive prompts', async () => {
    await runOnboardingFlow({
      rootDir,
      argv: ['project', '--skip'],
    })

    expect(questionMock).not.toHaveBeenCalled()
    expect(existsSync(join(rootDir, 'project', 'collabmd.json'))).toBe(true)
  })

  it('handles SIGINT with clean cancellation after step 1 writes', async () => {
    questionMock.mockImplementationOnce(async () => {
      process.emit('SIGINT')
      return ''
    })

    await runOnboardingFlow({
      rootDir,
      argv: ['project'],
    })

    const projectDir = join(rootDir, 'project')
    expect(existsSync(projectDir)).toBe(true)
    expect(existsSync(join(projectDir, 'collabmd.json'))).toBe(true)
    expect(logSpy).toHaveBeenCalledWith('\nCancelled.')
  })
})
