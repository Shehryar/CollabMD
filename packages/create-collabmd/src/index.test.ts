import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs'
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

import { runCreateCollabmd } from './index.js'

describe('create-collabmd onboarding', () => {
  let baseDir: string
  const originalCwd = process.cwd()

  beforeEach(() => {
    vi.clearAllMocks()
    questionMock.mockResolvedValue('')
    baseDir = mkdtempSync(join(tmpdir(), 'create-collabmd-'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    process.chdir(originalCwd)
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('creates expected scaffold files with content', async () => {
    process.chdir(baseDir)

    await runCreateCollabmd(['my-docs', '--skip=auth,workspace,invite,background,server'])

    const projectDir = join(baseDir, 'my-docs')
    expect(existsSync(projectDir)).toBe(true)
    expect(existsSync(join(projectDir, 'collabmd.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'COLLABMD.md'))).toBe(true)
    expect(existsSync(join(projectDir, 'docs', 'welcome.md'))).toBe(true)
    expect(existsSync(join(projectDir, '.collabmd'))).toBe(true)
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true)

    const config = JSON.parse(readFileSync(join(projectDir, 'collabmd.json'), 'utf-8')) as {
      name: string
    }
    expect(config.name).toBe('my-docs')
    expect(readFileSync(join(projectDir, '.gitignore'), 'utf-8')).toContain('.collabmd/')
  })

  it('--skip flag skips interactive prompts', async () => {
    process.chdir(baseDir)

    await runCreateCollabmd(['my-docs', '--skip'])

    expect(questionMock).not.toHaveBeenCalled()
  })

  it('uses mocked fetch during interactive workspace step', async () => {
    process.chdir(baseDir)
    vi.stubEnv('COLLABMD_TOKEN', 'token-from-env')
    questionMock
      .mockResolvedValueOnce('2') // server: collabmd.dev
      .mockResolvedValueOnce('1') // choose existing workspace

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'org-1', name: 'Workspace A' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    await runCreateCollabmd(['my-docs', '--skip=invite,background'])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://collabmd.dev/api/auth/organization/list',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-from-env',
        }),
      }),
    )

    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('handles ctrl+c without corrupting written files', async () => {
    process.chdir(baseDir)

    questionMock.mockImplementationOnce(async () => {
      process.emit('SIGINT')
      return ''
    })

    await runCreateCollabmd(['my-docs'])

    const projectDir = join(baseDir, 'my-docs')
    expect(existsSync(projectDir)).toBe(true)
    expect(existsSync(join(projectDir, 'collabmd.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'docs', 'welcome.md'))).toBe(true)
  })
})
