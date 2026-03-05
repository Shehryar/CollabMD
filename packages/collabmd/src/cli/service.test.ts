import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock-home'),
  platform: vi.fn(() => 'darwin'),
}))

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}))

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { platform } from 'os'
import { spawnSync } from 'child_process'
import {
  serviceControlCommand,
  serviceInstallCommand,
  serviceStatusCommand,
  serviceUninstallCommand,
} from './service.js'

const mockExistsSync = vi.mocked(existsSync)
const mockMkdirSync = vi.mocked(mkdirSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockRmSync = vi.mocked(rmSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockPlatform = vi.mocked(platform)
const mockSpawnSync = vi.mocked(spawnSync)

describe('service commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockReadFileSync.mockReturnValue('')
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' } as never)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('generates LaunchAgent plist on macOS install', () => {
    mockPlatform.mockReturnValue('darwin')
    process.argv[1] = '/usr/local/bin/collabmd'

    serviceInstallCommand()

    expect(mockMkdirSync).toHaveBeenCalledWith('/mock-home/.collabmd', { recursive: true })
    expect(mockMkdirSync).toHaveBeenCalledWith('/mock-home/Library/LaunchAgents', {
      recursive: true,
    })
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock-home/Library/LaunchAgents/dev.collabmd.daemon.plist',
      expect.stringContaining('<string>dev.collabmd.daemon</string>'),
    )
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock-home/Library/LaunchAgents/dev.collabmd.daemon.plist',
      expect.stringContaining('<string>daemon</string>'),
    )
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock-home/Library/LaunchAgents/dev.collabmd.daemon.plist',
      expect.stringContaining('<string>--background</string>'),
    )
  })

  it('generates systemd unit on Linux install', () => {
    mockPlatform.mockReturnValue('linux')
    process.argv[1] = '/usr/local/bin/collabmd'

    serviceInstallCommand()

    expect(mockMkdirSync).toHaveBeenCalledWith('/mock-home/.config/systemd/user', {
      recursive: true,
    })
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock-home/.config/systemd/user/collabmd.service',
      expect.stringContaining('ExecStart='),
    )
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock-home/.config/systemd/user/collabmd.service',
      expect.stringContaining('daemon --background'),
    )
  })

  it('uninstall on macOS removes plist and launchctl entry', () => {
    mockPlatform.mockReturnValue('darwin')
    mockExistsSync.mockReturnValue(true)

    serviceUninstallCommand()

    expect(mockRmSync).toHaveBeenCalledWith(
      '/mock-home/Library/LaunchAgents/dev.collabmd.daemon.plist',
    )
    expect(mockSpawnSync).toHaveBeenCalledWith('launchctl', ['remove', 'dev.collabmd.daemon'], {
      stdio: 'ignore',
    })
  })

  it('uninstall on Linux disables service and reloads daemon', () => {
    mockPlatform.mockReturnValue('linux')
    mockExistsSync.mockReturnValue(true)

    serviceUninstallCommand()

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'systemctl',
      ['--user', 'disable', '--now', 'collabmd.service'],
      { stdio: 'ignore' },
    )
    expect(mockRmSync).toHaveBeenCalledWith('/mock-home/.config/systemd/user/collabmd.service')
    expect(mockSpawnSync).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload'], {
      stdio: 'ignore',
    })
  })

  it('status reports running/stopped on macOS and linux', () => {
    mockPlatform.mockReturnValue('darwin')
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'pid 123', stderr: '' } as never)
    serviceStatusCommand()
    expect(logSpy).toHaveBeenCalledWith('running (launchd)')

    mockPlatform.mockReturnValue('linux')
    mockSpawnSync.mockReturnValueOnce({ status: 1, stdout: 'inactive', stderr: '' } as never)
    serviceStatusCommand()
    expect(logSpy).toHaveBeenCalledWith('stopped (systemd)')
  })

  it('serviceControlCommand runs start/stop/restart commands by platform', () => {
    mockPlatform.mockReturnValue('darwin')
    serviceControlCommand('start')
    serviceControlCommand('stop')
    serviceControlCommand('restart')
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'launchctl',
      ['load', '-w', '/mock-home/Library/LaunchAgents/dev.collabmd.daemon.plist'],
      { stdio: 'inherit' },
    )
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'launchctl',
      ['unload', '-w', '/mock-home/Library/LaunchAgents/dev.collabmd.daemon.plist'],
      { stdio: 'inherit' },
    )

    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockPlatform.mockReturnValue('linux')
    serviceControlCommand('restart')
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'systemctl',
      ['--user', 'restart', 'collabmd.service'],
      { stdio: 'inherit' },
    )
  })

  it('prints unsupported platform message and status log tail', () => {
    mockPlatform.mockReturnValue('win32')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('line1\nline2\nline3')

    serviceStatusCommand()
    serviceInstallCommand()
    serviceUninstallCommand()
    serviceControlCommand('start')

    expect(logSpy).toHaveBeenCalledWith(
      'Service status is currently supported on macOS and Linux only.',
    )
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('line'))
    expect(logSpy).toHaveBeenCalledWith(
      'Service install is currently supported on macOS and Linux only.',
    )
    expect(logSpy).toHaveBeenCalledWith(
      'Service uninstall is currently supported on macOS and Linux only.',
    )
    expect(logSpy).toHaveBeenCalledWith(
      'Service start is currently supported on macOS and Linux only.',
    )
  })
})
