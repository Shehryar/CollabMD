import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('../daemon/registry.js', () => ({
  addProject: vi.fn(),
  removeProject: vi.fn(),
}))

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { addProject, removeProject } from '../daemon/registry.js'
import { linkCommand } from './link.js'
import { unlinkCommand } from './unlink.js'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockAddProject = vi.mocked(addProject)
const mockRemoveProject = vi.mocked(removeProject)

describe('link/unlink commands', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('link writes to collabmd.json and global registry', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ orgId: 'org-1' }))

    linkCommand('https://collabmd.dev')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `${process.cwd()}/collabmd.json`,
      expect.stringContaining('"server": "https://collabmd.dev"'),
    )
    expect(mockAddProject).toHaveBeenCalledWith(
      expect.objectContaining({
        path: process.cwd(),
        orgId: 'org-1',
        serverUrl: 'https://collabmd.dev',
      }),
    )
  })

  it('unlink removes from registry but does not rewrite collabmd.json', () => {
    unlinkCommand()

    expect(mockRemoveProject).toHaveBeenCalledWith(process.cwd())
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })
})

