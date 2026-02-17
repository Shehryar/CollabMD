import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckIsRepo,
  mockStatus,
  mockAdd,
  mockCommit,
  simpleGitFactory,
} = vi.hoisted(() => {
  const checkIsRepo = vi.fn()
  const status = vi.fn()
  const add = vi.fn()
  const commit = vi.fn()

  const git = {
    checkIsRepo,
    status,
    add,
    commit,
  }

  return {
    mockCheckIsRepo: checkIsRepo,
    mockStatus: status,
    mockAdd: add,
    mockCommit: commit,
    simpleGitFactory: vi.fn(() => git),
  }
})

vi.mock('simple-git', () => ({
  default: simpleGitFactory,
}))

import { GitSync } from './git-sync.js'

function makeStatus(files: Array<{ path: string; kind?: 'M' | 'A' | '?' }>) {
  const modified = files.filter((entry) => entry.kind === 'M' || !entry.kind).map((entry) => entry.path)
  const created = files.filter((entry) => entry.kind === 'A').map((entry) => entry.path)
  const notAdded = files.filter((entry) => entry.kind === '?').map((entry) => entry.path)

  return {
    modified,
    created,
    not_added: notAdded,
    staged: [],
    renamed: [],
    files: files.map((entry) => ({
      path: entry.path,
      index: ' ',
      working_dir: entry.kind === 'A' ? 'A' : 'M',
    })),
  }
}

describe('GitSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-12T10:00:00.000Z'))

    vi.clearAllMocks()
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(makeStatus([]))
    mockAdd.mockResolvedValue(undefined)
    mockCommit.mockResolvedValue({ commit: 'abc123' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('notifyFileChange resets the idle timer', async () => {
    const sync = new GitSync({
      workDir: '/repo',
      enabled: true,
      idleTimeoutMs: 100,
    })
    await sync.ready()

    mockStatus.mockResolvedValue(makeStatus([{ path: 'docs/a.md' }]))

    sync.notifyFileChange('docs/a.md')
    await vi.advanceTimersByTimeAsync(60)
    sync.notifyFileChange('docs/a.md')

    await vi.advanceTimersByTimeAsync(60)
    expect(mockStatus).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(50)
    expect(mockStatus).toHaveBeenCalledTimes(1)

    sync.destroy()
  })

  it('auto-commit fires after idle timeout with correct files staged', async () => {
    const sync = new GitSync({
      workDir: '/repo',
      enabled: true,
      idleTimeoutMs: 50,
    })
    await sync.ready()

    mockStatus.mockResolvedValue(makeStatus([
      { path: 'docs/a.md' },
      { path: 'docs/b.md' },
    ]))

    sync.notifyFileChange('docs/b.md')
    sync.notifyFileChange('docs/a.md')

    await vi.advanceTimersByTimeAsync(60)

    expect(mockAdd).toHaveBeenCalledWith(['docs/a.md', 'docs/b.md'])
    expect(mockCommit).toHaveBeenCalledWith('collabmd: auto-save docs/a.md, docs/b.md')

    sync.destroy()
  })

  it('only stages markdown files', async () => {
    const sync = new GitSync({
      workDir: '/repo',
      enabled: true,
      idleTimeoutMs: 50,
    })
    await sync.ready()

    mockStatus.mockResolvedValue(makeStatus([
      { path: 'docs/a.md' },
      { path: 'docs/notes.txt' },
      { path: 'docs/meta.json' },
    ]))

    sync.notifyFileChange('docs/a.md')
    sync.notifyFileChange('docs/notes.txt')
    sync.notifyFileChange('docs/meta.json')

    await vi.advanceTimersByTimeAsync(60)

    expect(mockAdd).toHaveBeenCalledWith(['docs/a.md'])

    sync.destroy()
  })

  it('substitutes commit message template placeholders', async () => {
    const sync = new GitSync({
      workDir: '/repo',
      enabled: true,
      idleTimeoutMs: 50,
      commitTemplate: 'auto-save {files} ({count}) at {timestamp}',
    })
    await sync.ready()

    mockStatus.mockResolvedValue(makeStatus([{ path: 'docs/a.md' }]))

    sync.notifyFileChange('docs/a.md')

    await vi.advanceTimersByTimeAsync(60)

    expect(mockCommit).toHaveBeenCalledWith(
      expect.stringMatching(/^auto-save docs\/a\.md \(1\) at 2026-02-12T10:00:00\.\d{3}Z$/),
    )

    sync.destroy()
  })

  it('skips commit when git status is clean', async () => {
    const sync = new GitSync({
      workDir: '/repo',
      enabled: true,
      idleTimeoutMs: 50,
    })
    await sync.ready()

    mockStatus.mockResolvedValue(makeStatus([]))

    sync.notifyFileChange('docs/a.md')

    await vi.advanceTimersByTimeAsync(60)

    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockCommit).not.toHaveBeenCalled()

    sync.destroy()
  })

  it('logs warning and keeps running when git operations fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const sync = new GitSync({
      workDir: '/repo',
      enabled: true,
      idleTimeoutMs: 50,
    })
    await sync.ready()

    mockStatus
      .mockRejectedValueOnce(new Error('status failed'))
      .mockResolvedValueOnce(makeStatus([{ path: 'docs/a.md' }]))

    sync.notifyFileChange('docs/a.md')
    await vi.advanceTimersByTimeAsync(60)

    sync.notifyFileChange('docs/a.md')
    await vi.advanceTimersByTimeAsync(60)

    expect(warnSpy).toHaveBeenCalledWith('[git-sync] Auto-commit failed:', expect.any(Error))
    expect(mockCommit).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
    sync.destroy()
  })

  it('disables auto-commit when workDir is not a git repo', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockCheckIsRepo.mockResolvedValue(false)

    const sync = new GitSync({
      workDir: '/not-repo',
      enabled: true,
      idleTimeoutMs: 50,
    })
    await sync.ready()

    sync.notifyFileChange('docs/a.md')
    await vi.advanceTimersByTimeAsync(60)

    expect(sync.isEnabled()).toBe(false)
    expect(mockStatus).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)

    logSpy.mockRestore()
    sync.destroy()
  })

  it('stays disabled when auto-commit config is false', async () => {
    const sync = new GitSync({
      workDir: '/repo',
      enabled: false,
      idleTimeoutMs: 50,
    })

    await sync.ready()
    sync.notifyFileChange('docs/a.md')
    await vi.advanceTimersByTimeAsync(60)

    expect(sync.isEnabled()).toBe(false)
    expect(simpleGitFactory).not.toHaveBeenCalled()
    expect(mockStatus).not.toHaveBeenCalled()

    sync.destroy()
  })

  it('destroy clears pending timers', async () => {
    const sync = new GitSync({
      workDir: '/repo',
      enabled: true,
      idleTimeoutMs: 100,
    })
    await sync.ready()

    sync.notifyFileChange('docs/a.md')
    sync.destroy()

    await vi.advanceTimersByTimeAsync(120)

    expect(mockStatus).not.toHaveBeenCalled()
  })
})
