import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}))

vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}))

import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { addProject, getProject, readRegistry, removeProject, writeRegistry, type ProjectConfig } from './registry.js'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockRenameSync = vi.mocked(renameSync)

const FILE = '/mock-home/.collabmd/projects.json'
const TMP_FILE = '/mock-home/.collabmd/projects.json.tmp'

const projectA: ProjectConfig = {
  path: '/Users/me/docs',
  orgId: 'org-1',
  serverUrl: 'https://collabmd.dev',
  addedAt: '2026-02-10T10:00:00.000Z',
}

const projectB: ProjectConfig = {
  path: '/Users/me/work/specs',
  orgId: 'org-2',
  serverUrl: 'https://collabmd.dev',
  addedAt: '2026-02-10T10:05:00.000Z',
}

describe('registry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('read empty/missing file returns []', () => {
    mockExistsSync.mockReturnValue(false)
    expect(readRegistry()).toEqual([])
  })

  it('add project then read back', () => {
    mockExistsSync
      .mockReturnValueOnce(false) // readRegistry in addProject
      .mockReturnValueOnce(true) // dir exists in writeRegistry
      .mockReturnValueOnce(true) // readRegistry after add
    mockReadFileSync.mockReturnValueOnce(JSON.stringify([projectA]))

    addProject(projectA)

    expect(mockWriteFileSync).toHaveBeenCalledWith(TMP_FILE, expect.stringContaining('"orgId": "org-1"'))
    expect(mockRenameSync).toHaveBeenCalledWith(TMP_FILE, FILE)
    expect(readRegistry()).toEqual([projectA])
  })

  it('add duplicate path updates existing entry', () => {
    const updated = { ...projectA, orgId: 'org-updated' }
    mockExistsSync
      .mockReturnValueOnce(true) // readRegistry in addProject
      .mockReturnValueOnce(true) // dir exists in writeRegistry
      .mockReturnValueOnce(true) // readRegistry verify
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify([projectA]))
      .mockReturnValueOnce(JSON.stringify([updated]))

    addProject(updated)

    expect(mockWriteFileSync).toHaveBeenCalledWith(TMP_FILE, expect.stringContaining('"orgId": "org-updated"'))
    expect(readRegistry()).toEqual([updated])
  })

  it('remove project by path', () => {
    mockExistsSync
      .mockReturnValueOnce(true) // readRegistry for removeProject
      .mockReturnValueOnce(true) // dir exists for write
      .mockReturnValueOnce(true) // readRegistry verify
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify([projectA, projectB]))
      .mockReturnValueOnce(JSON.stringify([projectB]))

    removeProject(projectA.path)

    expect(mockWriteFileSync).toHaveBeenCalledWith(TMP_FILE, expect.not.stringContaining(projectA.path))
    expect(readRegistry()).toEqual([projectB])
  })

  it('multiple projects coexist and getProject finds by path', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify([projectA, projectB]))

    expect(readRegistry()).toEqual([projectA, projectB])
    expect(getProject(projectB.path)).toEqual(projectB)
  })

  it('writeRegistry writes atomically', () => {
    mockExistsSync.mockReturnValue(true)

    writeRegistry([projectA, projectB])

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      TMP_FILE,
      JSON.stringify([projectA, projectB], null, 2) + '\n',
    )
    expect(mockRenameSync).toHaveBeenCalledWith(TMP_FILE, FILE)
  })
})

