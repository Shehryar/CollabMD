import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetRemotes,
  mockBranch,
  mockPush,
  simpleGitFactory,
} = vi.hoisted(() => {
  const getRemotes = vi.fn()
  const branch = vi.fn()
  const push = vi.fn()

  const git = {
    getRemotes,
    branch,
    push,
  }

  return {
    mockGetRemotes: getRemotes,
    mockBranch: branch,
    mockPush: push,
    simpleGitFactory: vi.fn(() => git),
  }
})

vi.mock('simple-git', () => ({
  default: simpleGitFactory,
}))

import { pushCommand } from './push.js'

describe('pushCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRemotes.mockResolvedValue([{ name: 'origin' }])
    mockBranch.mockResolvedValue({ current: 'main' })
    mockPush.mockResolvedValue(undefined)
  })

  it('pushes current branch to origin by default', async () => {
    await pushCommand({ workDir: '/repo' })

    expect(simpleGitFactory).toHaveBeenCalledWith('/repo')
    expect(mockPush).toHaveBeenCalledWith('origin', 'main')
  })

  it('pushes using custom remote and branch options', async () => {
    mockGetRemotes.mockResolvedValue([{ name: 'upstream' }])

    await pushCommand({
      workDir: '/repo',
      remote: 'upstream',
      branch: 'feature/docs',
    })

    expect(mockPush).toHaveBeenCalledWith('upstream', 'feature/docs')
  })

  it('prints error details when push fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPush.mockRejectedValue(new Error('rejected'))

    await pushCommand({ workDir: '/repo' })

    expect(errorSpy).toHaveBeenCalledWith('Push failed: rejected')
    expect(errorSpy).toHaveBeenCalledWith(
      'Push was rejected. Try running `collabmd pull` first, then push again.',
    )

    errorSpy.mockRestore()
  })
})
