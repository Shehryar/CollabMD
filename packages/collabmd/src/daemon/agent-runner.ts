import { spawn, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

interface AgentCommand {
  command: string
  timeout?: number
  cwd?: string
  env?: Record<string, string>
}

export interface AgentRunnerConfig {
  enabled?: boolean
  timeout?: number
  commands?: Record<string, AgentCommand>
}

export class AgentRunner {
  private workDir: string
  private config: AgentRunnerConfig
  private runningProcesses = new Map<string, { kill: () => void }>()
  private dispatched = new Set<string>()

  constructor(options: { workDir: string; config?: AgentRunnerConfig | null }) {
    this.workDir = options.workDir
    this.config = options.config ?? {}
  }

  isEnabled(): boolean {
    if (this.config.enabled === false) return false
    if (!this.config.commands || Object.keys(this.config.commands).length === 0) return false
    return true
  }

  async handleTriggerCreated(triggerRelativePath: string): Promise<void> {
    try {
      if (this.dispatched.has(triggerRelativePath)) return
      this.dispatched.add(triggerRelativePath)

      const triggerPath = join(this.workDir, triggerRelativePath)
      if (!existsSync(triggerPath)) {
        console.log(`[AgentRunner] Trigger file not found: ${triggerRelativePath}`)
        return
      }

      let raw: string
      try {
        raw = readFileSync(triggerPath, 'utf-8')
      } catch {
        console.log(`[AgentRunner] Failed to read trigger file: ${triggerRelativePath}`)
        return
      }

      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(raw) as Record<string, unknown>
      } catch {
        console.log(`[AgentRunner] Invalid JSON in trigger file: ${triggerRelativePath}`)
        return
      }

      const mentionedAgent =
        typeof payload.mentionedAgent === 'string' ? payload.mentionedAgent.trim() : ''
      if (!mentionedAgent) {
        console.log(`[AgentRunner] No mentionedAgent in trigger file: ${triggerRelativePath}`)
        return
      }

      const agentCommand = this.config.commands?.[mentionedAgent]
      if (!agentCommand) {
        console.log(`[AgentRunner] No command configured for agent: ${mentionedAgent}`)
        return
      }

      const timeoutSeconds = agentCommand.timeout ?? this.config.timeout ?? 30
      const cwd = agentCommand.cwd ?? this.workDir
      const env = agentCommand.env ? { ...process.env, ...agentCommand.env } : process.env

      const result = await this.executeCommand({
        command: agentCommand.command,
        stdin: raw,
        cwd,
        env: env as NodeJS.ProcessEnv,
        timeoutMs: timeoutSeconds * 1000,
        triggerRelativePath,
      })

      if (result === null) return

      let response: Record<string, unknown>
      try {
        response = JSON.parse(result) as Record<string, unknown>
      } catch {
        console.log(`[AgentRunner] Command for ${mentionedAgent} returned invalid JSON`)
        return
      }

      if (payload.commentId !== undefined) {
        response.commentId = payload.commentId
      }
      if (payload.discussionId !== undefined) {
        response.discussionId = payload.discussionId
      }
      response.mentionedAgent = mentionedAgent

      const responsePath = triggerRelativePath.replace(/\.json$/, '.response.json')
      const responseAbsPath = join(this.workDir, responsePath)

      mkdirSync(dirname(responseAbsPath), { recursive: true })
      try {
        writeFileSync(responseAbsPath, JSON.stringify(response, null, 2) + '\n', 'utf-8')
        console.log(`[AgentRunner] Wrote response for ${mentionedAgent}: ${responsePath}`)
      } catch (err) {
        console.log(`[AgentRunner] Failed to write response file: ${responsePath}`, err)
      }
    } catch (err) {
      console.log(`[AgentRunner] Unexpected error handling trigger: ${triggerRelativePath}`, err)
    }
  }

  destroy(): void {
    for (const [key, proc] of this.runningProcesses) {
      try {
        proc.kill()
      } catch {
        // ignore
      }
      this.runningProcesses.delete(key)
    }
  }

  private executeCommand(options: {
    command: string
    stdin: string
    cwd: string
    env: NodeJS.ProcessEnv
    timeoutMs: number
    triggerRelativePath: string
  }): Promise<string | null> {
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(options.command, {
          shell: true,
          cwd: options.cwd,
          env: options.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err) {
        console.log(`[AgentRunner] Failed to spawn command: ${options.command}`, err)
        resolve(null)
        return
      }

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false

      const cleanup = () => {
        if (settled) return
        settled = true
        this.runningProcesses.delete(options.triggerRelativePath)
        if (timer) clearTimeout(timer)
      }

      this.runningProcesses.set(options.triggerRelativePath, {
        kill: () => {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        },
      })

      const timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, options.timeoutMs)

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.stdin?.on('error', () => {
        // Some commands exit immediately and close stdin before the payload is written.
      })

      child.on('error', (err) => {
        cleanup()
        console.log(`[AgentRunner] Command error: ${options.command}`, err)
        resolve(null)
      })

      child.on('close', (code) => {
        cleanup()
        if (timedOut) {
          console.log(`[AgentRunner] Command timed out: ${options.command}`)
          resolve(null)
          return
        }
        if (code !== 0) {
          console.log(`[AgentRunner] Command exited with code ${code}: ${options.command}`)
          if (stderr) console.log(`[AgentRunner] stderr: ${stderr.slice(0, 500)}`)
          resolve(null)
          return
        }
        resolve(stdout)
      })

      try {
        child.stdin?.write(options.stdin)
        child.stdin?.end()
      } catch {
        // stdin may already be closed
      }
    })
  }
}
