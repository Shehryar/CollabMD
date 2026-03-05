import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { agentAddCommand, agentListCommand, agentRemoveCommand } from './agent.js'

describe('CLI agent commands', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'collabmd-agent-cli-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('agentAddCommand', () => {
    it('creates collabmd.json if it does not exist and adds agent', () => {
      agentAddCommand('writer', { command: 'node writer.js' }, tempDir)

      const configPath = join(tempDir, 'collabmd.json')
      expect(existsSync(configPath)).toBe(true)

      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.agents.enabled).toBe(true)
      expect(config.agents.commands.writer).toEqual({ command: 'node writer.js' })
    })

    it('adds to existing config without losing other fields', () => {
      const configPath = join(tempDir, 'collabmd.json')
      writeFileSync(
        configPath,
        JSON.stringify({ server: 'http://localhost:3000', foo: 'bar' }, null, 2) + '\n',
      )

      agentAddCommand('reviewer', { command: 'python review.py' }, tempDir)

      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.server).toBe('http://localhost:3000')
      expect(config.foo).toBe('bar')
      expect(config.agents.commands.reviewer).toEqual({ command: 'python review.py' })
    })

    it('includes timeout and cwd options when provided', () => {
      agentAddCommand('qa', { command: 'npm run qa', timeout: '30', cwd: '/tmp/qa' }, tempDir)

      const config = JSON.parse(readFileSync(join(tempDir, 'collabmd.json'), 'utf-8'))
      expect(config.agents.commands.qa).toEqual({
        command: 'npm run qa',
        timeout: 30,
        cwd: '/tmp/qa',
      })
    })

    it('does not override enabled if already set', () => {
      const configPath = join(tempDir, 'collabmd.json')
      writeFileSync(
        configPath,
        JSON.stringify({ agents: { enabled: false, commands: {} } }, null, 2) + '\n',
      )

      agentAddCommand('helper', { command: 'echo hi' }, tempDir)

      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.agents.enabled).toBe(false)
    })
  })

  describe('agentListCommand', () => {
    it('shows configured agents', () => {
      const configPath = join(tempDir, 'collabmd.json')
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              commands: {
                writer: { command: 'node writer.js' },
                reviewer: { command: 'python review.py', timeout: 60 },
              },
            },
          },
          null,
          2,
        ) + '\n',
      )

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      agentListCommand(tempDir)

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('@writer'))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('node writer.js'))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('@reviewer'))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('timeout: 60s'))
    })

    it('shows "No agents configured." when empty', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      agentListCommand(tempDir)

      expect(logSpy).toHaveBeenCalledWith('No agents configured.')
    })

    it('shows "No agents configured." when config exists but has no agents', () => {
      const configPath = join(tempDir, 'collabmd.json')
      writeFileSync(configPath, JSON.stringify({ server: 'http://localhost:3000' }, null, 2) + '\n')

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      agentListCommand(tempDir)

      expect(logSpy).toHaveBeenCalledWith('No agents configured.')
    })
  })

  describe('agentRemoveCommand', () => {
    it('removes agent from config', () => {
      const configPath = join(tempDir, 'collabmd.json')
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              enabled: true,
              commands: {
                writer: { command: 'node writer.js' },
                reviewer: { command: 'python review.py' },
              },
            },
          },
          null,
          2,
        ) + '\n',
      )

      agentRemoveCommand('writer', tempDir)

      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.agents.commands.writer).toBeUndefined()
      expect(config.agents.commands.reviewer).toEqual({ command: 'python review.py' })
    })

    it('prints not found for missing agent', () => {
      const configPath = join(tempDir, 'collabmd.json')
      writeFileSync(configPath, JSON.stringify({ agents: { commands: {} } }, null, 2) + '\n')

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      agentRemoveCommand('missing', tempDir)

      expect(logSpy).toHaveBeenCalledWith('Agent @missing not found in config.')
    })

    it('prints not found when no config exists', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      agentRemoveCommand('missing', tempDir)

      expect(logSpy).toHaveBeenCalledWith('Agent @missing not found in config.')
    })
  })
})
