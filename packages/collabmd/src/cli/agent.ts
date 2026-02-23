import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface AgentCommandEntry {
  command: string
  timeout?: number
  cwd?: string
}

interface AgentConfig {
  enabled?: boolean
  commands?: Record<string, AgentCommandEntry>
}

function readConfig(cwd: string): Record<string, unknown> {
  const configPath = join(cwd, 'collabmd.json')
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
  }
  return {}
}

function writeConfig(cwd: string, config: Record<string, unknown>): void {
  const configPath = join(cwd, 'collabmd.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function agentAddCommand(
  name: string,
  options: { command: string; timeout?: string; cwd?: string },
  cwd: string = process.cwd(),
): void {
  const config = readConfig(cwd)

  const agents = (config.agents ?? {}) as Record<string, unknown>
  const commands = (agents.commands ?? {}) as Record<string, unknown>

  const entry: Record<string, unknown> = { command: options.command }
  if (options.timeout) entry.timeout = parseInt(options.timeout, 10)
  if (options.cwd) entry.cwd = options.cwd

  commands[name] = entry
  agents.commands = commands
  if ((agents as AgentConfig).enabled === undefined) agents.enabled = true
  config.agents = agents

  writeConfig(cwd, config)
  console.log(`Added agent @${name} with command: ${options.command}`)
  console.log(`Config saved to ${join(cwd, 'collabmd.json')}`)
}

export function agentListCommand(cwd: string = process.cwd()): void {
  const config = readConfig(cwd)
  const agents = (config.agents ?? {}) as AgentConfig
  const commands = agents.commands ?? {}

  const entries = Object.entries(commands)
  if (entries.length === 0) {
    console.log('No agents configured.')
    return
  }

  for (const [agentName, entry] of entries) {
    const cmd = (entry as AgentCommandEntry).command
    const timeout = (entry as AgentCommandEntry).timeout
    let line = `@${agentName} — ${cmd}`
    if (timeout) line += ` (timeout: ${timeout}s)`
    console.log(line)
  }
}

export function agentRemoveCommand(name: string, cwd: string = process.cwd()): void {
  const config = readConfig(cwd)
  const agents = (config.agents ?? {}) as Record<string, unknown>
  const commands = (agents.commands ?? {}) as Record<string, unknown>

  if (!(name in commands)) {
    console.log(`Agent @${name} not found in config.`)
    return
  }

  delete commands[name]
  agents.commands = commands
  config.agents = agents

  writeConfig(cwd, config)
  console.log(`Removed agent @${name} from config.`)
}
