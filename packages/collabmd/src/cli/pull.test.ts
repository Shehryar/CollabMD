import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

const {
  mockGetRemotes,
  mockStatus,
  mockBranch,
  mockFetch,
  mockMerge,
  simpleGitFactory,
} = vi.hoisted(() => {
  const getRemotes = vi.fn()
  const status = vi.fn()
  const branch = vi.fn()
  const fetch = vi.fn()
  const merge = vi.fn()

  const git = {
    getRemotes,
    status,
    branch,
    fetch,
    merge,
  }

  return {
    mockGetRemotes: getRemotes,
    mockStatus: status,
    mockBranch: branch,
    mockFetch: fetch,
    mockMerge: merge,
    simpleGitFactory: vi.fn(() => git),
  }
})

vi.mock('simple-git', () => ({
  default: simpleGitFactory,
}))

import { mkdirSync, writeFileSync } from 'fs'
import { pullCommand } from './pull.js'

const mockMkdirSync = vi.mocked(mkdirSync)
const mockWriteFileSync = vi.mocked(writeFileSync)

describe('pullCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-12T10:00:00.000Z'))

    vi.clearAllMocks()

    mockGetRemotes.mockResolvedValue([{ name: 'origin' }])
    mockStatus.mockResolvedValue({ files: [], conflicted: [] })
    mockBranch.mockResolvedValue({ current: 'main' })
    mockFetch.mockResolvedValue(undefined)
    mockMerge.mockResolvedValue({ files: ['docs/a.md'], conflicts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches and merges the target branch', async () => {
    await pullCommand({ workDir: '/repo' })

    expect(mockFetch).toHaveBeenCalledWith('origin')
    expect(mockMerge).toHaveBeenCalledWith(['origin/main'])
  })

  it('prints success output for a clean merge', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mockMerge.mockResolvedValue({
      files: ['docs/a.md', 'docs/b.md'],
      conflicts: [],
    })

    await pullCommand({ workDir: '/repo' })

    expect(logSpy).toHaveBeenCalledWith('Pulled main from origin.')
    expect(logSpy).toHaveBeenCalledWith('Changed files:')
    expect(logSpy).toHaveBeenCalledWith('- docs/a.md')
    expect(logSpy).toHaveBeenCalledWith('- docs/b.md')

    logSpy.mockRestore()
  })

  it('writes conflicts.json and prints file list when merge conflicts are detected', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mockMerge.mockResolvedValue({
      files: [],
      conflicts: [{ file: 'docs/conflicted.md' }],
    })

    await pullCommand({ workDir: '/repo' })

    expect(mockMkdirSync).toHaveBeenCalledWith('/repo/.collabmd', { recursive: true })
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/repo/.collabmd/conflicts.json',
      expect.stringContaining('"docs/conflicted.md"'),
    )
    expect(logSpy).toHaveBeenCalledWith('Merge conflicts detected:')
    expect(logSpy).toHaveBeenCalledWith('- docs/conflicted.md')
    expect(logSpy).toHaveBeenCalledWith('Resolve conflicts in your editor, then run collabmd push')

    logSpy.mockRestore()
  })

  it('aborts pull when the repository has uncommitted changes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockStatus.mockResolvedValue({
      files: [{ path: 'docs/a.md', working_dir: 'M', index: ' ' }],
      conflicted: [],
    })

    await pullCommand({ workDir: '/repo' })

    expect(errorSpy).toHaveBeenCalledWith(
      'Pull aborted: repository has uncommitted changes. Commit or stash your changes first.',
    )
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockMerge).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
