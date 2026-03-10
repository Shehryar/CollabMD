#!/usr/bin/env tsx
/**
 * queue.ts — Autonomous ticket runner for CollabMD.
 *
 * Usage:
 *   tsx scripts/queue.ts progress          # show queue status
 *   tsx scripts/queue.ts progress --json   # emit JSON for dashboards
 *   tsx scripts/queue.ts list              # list all tickets
 *   tsx scripts/queue.ts list --todo       # list only todo tickets
 *   tsx scripts/queue.ts run               # run next ready auto ticket
 *   tsx scripts/queue.ts run --dry-run     # show what would run without executing
 *   tsx scripts/queue.ts run --agent claude # use claude (default)
 *   tsx scripts/queue.ts run --agent codex  # use codex
 *   tsx scripts/queue.ts run --loop        # keep running until no ready tickets
 *   tsx scripts/queue.ts validate T-080    # run validation for a specific ticket
 *
 * Environment:
 *   PROGRESS_MD — path to Progress.md (default: ~/Documents/Notes/.../Progress.md)
 */

import { execSync, spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  parseProgressDoc,
  findNextReady,
  getProgressSummary,
  formatProgress,
  summaryToJson,
  updateTicketStatus,
  writeProgressDoc,
  buildAgentPrompt,
  type Ticket,
  type QueueState,
} from './queue-lib.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..')
const AGENT_SETUP_PATH = resolve(REPO_ROOT, 'AGENT_SETUP.md')

function getAgentSetup(): string {
  if (existsSync(AGENT_SETUP_PATH)) {
    return readFileSync(AGENT_SETUP_PATH, 'utf-8')
  }
  return '(no AGENT_SETUP.md found)'
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdProgress(args: string[]): void {
  const state = parseProgressDoc(process.env.PROGRESS_MD)
  const summary = getProgressSummary(state.tickets)

  if (args.includes('--json')) {
    console.log(summaryToJson(summary))
  } else {
    console.log(formatProgress(summary))
  }
}

function cmdList(args: string[]): void {
  const state = parseProgressDoc(process.env.PROGRESS_MD)
  const filterTodo = args.includes('--todo')
  const filterAuto = args.includes('--auto')

  let tickets = state.tickets
  if (filterTodo) tickets = tickets.filter((t) => t.status === 'todo' || t.status === 'blocked')
  if (filterAuto) tickets = tickets.filter((t) => t.autonomy === 'auto')

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        tickets.map((t) => ({
          id: t.id,
          phase: t.phase,
          title: t.title,
          status: t.status,
          autonomy: t.autonomy,
          deps: t.deps,
          note: t.note,
        })),
        null,
        2
      )
    )
    return
  }

  const statusIcon: Record<string, string> = {
    todo: '[ ]',
    in_progress: '[/]',
    done: '[x]',
    cut: '[-]',
    blocked: '[!]',
  }

  for (const t of tickets) {
    const icon = statusIcon[t.status] ?? '[ ]'
    const auto = t.autonomy === 'auto' ? 'auto' : '    '
    const deps = t.deps.length > 0 ? ` deps:${t.deps.join(',')}` : ''
    const note = t.note ? ` — ${t.note}` : ''
    console.log(`${icon} ${auto} ${t.id.padEnd(6)} ${t.phase.padEnd(18)} ${t.title}${deps}${note}`)
  }
}

function cmdValidate(args: string[]): void {
  const ticketId = args[0]
  if (!ticketId) {
    console.error('Usage: queue.ts validate <ticket-id>')
    process.exit(1)
  }

  const state = parseProgressDoc(process.env.PROGRESS_MD)
  const ticket = state.tickets.find((t) => t.id === ticketId)
  if (!ticket) {
    console.error(`Ticket ${ticketId} not found`)
    process.exit(1)
  }

  console.log(`Running validation for ${ticketId}: ${ticket.validate}`)
  try {
    execSync(ticket.validate, { cwd: REPO_ROOT, stdio: 'inherit' })
    console.log(`\n✓ Validation passed for ${ticketId}`)
  } catch {
    console.error(`\n✗ Validation failed for ${ticketId}`)
    process.exit(1)
  }
}

async function cmdRun(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run')
  const loop = args.includes('--loop')
  const agentFlag = args.includes('--agent')
    ? args[args.indexOf('--agent') + 1]
    : 'claude'

  const agentSetup = getAgentSetup()

  let iteration = 0
  const maxIterations = 50 // safety cap

  do {
    iteration++
    if (iteration > maxIterations) {
      console.log(`\nSafety cap reached (${maxIterations} iterations). Stopping.`)
      break
    }

    const state = parseProgressDoc(process.env.PROGRESS_MD)
    const ticket = findNextReady(state.tickets)

    if (!ticket) {
      console.log('\nNo ready auto tickets. Queue is clear or all remaining are manual/blocked.')
      const summary = getProgressSummary(state.tickets)
      if (summary.blocked.length > 0) {
        console.log('\nBlocked tickets:')
        for (const t of summary.blocked) {
          console.log(`  [!] ${t.id}: ${t.title} — ${t.note}`)
        }
      }
      break
    }

    console.log(`\n${'='.repeat(70)}`)
    console.log(`Ticket: ${ticket.id} — ${ticket.title}`)
    console.log(`Phase:  ${ticket.phase} — ${ticket.phaseTitle}`)
    console.log(`Agent:  ${agentFlag}`)
    console.log(`Validate: ${ticket.validate}`)
    console.log(`${'='.repeat(70)}`)

    if (dryRun) {
      console.log('\n[DRY RUN] Would execute this ticket. Prompt preview:\n')
      const prompt = buildAgentPrompt(ticket, agentSetup)
      // Show first 40 lines of prompt
      const promptLines = prompt.split('\n')
      console.log(promptLines.slice(0, 40).join('\n'))
      if (promptLines.length > 40) {
        console.log(`\n... (${promptLines.length - 40} more lines)`)
      }
      console.log('\n[DRY RUN] Skipping execution.')
      break
    }

    // Claim the ticket
    console.log(`\nClaiming ${ticket.id} as in_progress...`)
    let content = updateTicketStatus(state.raw, ticket.id, 'in_progress')
    writeProgressDoc(state.filePath, content)

    // Execute agent
    const prompt = buildAgentPrompt(ticket, agentSetup)
    let success = false
    let agentOutput = ''

    try {
      agentOutput = await executeAgent(agentFlag, prompt, ticket)
      success = true
    } catch (err) {
      console.error(`\nAgent execution failed:`, err)
      agentOutput = `Agent failed: ${err instanceof Error ? err.message : String(err)}`
    }

    if (success) {
      // Run validation
      console.log(`\nRunning validation: ${ticket.validate}`)
      try {
        execSync(ticket.validate, { cwd: REPO_ROOT, stdio: 'inherit', timeout: 600_000 })
        console.log(`\n✓ Validation passed for ${ticket.id}`)

        // Mark done
        const freshState = parseProgressDoc(process.env.PROGRESS_MD)
        const timestamp = new Date().toISOString().slice(0, 10)
        content = updateTicketStatus(
          freshState.raw,
          ticket.id,
          'done',
          `completed ${timestamp} by ${agentFlag}`
        )
        writeProgressDoc(freshState.filePath, content)
        console.log(`✓ ${ticket.id} marked as done`)
      } catch {
        console.error(`\n✗ Validation failed for ${ticket.id}`)
        // Revert to todo
        const freshState = parseProgressDoc(process.env.PROGRESS_MD)
        content = updateTicketStatus(
          freshState.raw,
          ticket.id,
          'todo',
          `validation failed — needs investigation`
        )
        writeProgressDoc(freshState.filePath, content)
        console.log(`${ticket.id} reverted to todo (validation failed)`)
        if (!loop) break
      }
    } else {
      // Revert to todo with error note
      const freshState = parseProgressDoc(process.env.PROGRESS_MD)
      content = updateTicketStatus(
        freshState.raw,
        ticket.id,
        'todo',
        `agent failed — ${agentOutput.slice(0, 100)}`
      )
      writeProgressDoc(freshState.filePath, content)
      console.log(`${ticket.id} reverted to todo (agent failed)`)
      if (!loop) break
    }
  } while (loop)
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

function executeAgent(
  agent: string,
  prompt: string,
  ticket: Ticket
): Promise<string> {
  return new Promise((resolve, reject) => {
    let cmd: string
    let cmdArgs: string[]

    switch (agent) {
      case 'codex':
        cmd = 'codex'
        cmdArgs = ['exec', '--quiet', '-']
        break
      case 'claude':
        cmd = 'claude'
        cmdArgs = ['-p', '--output-format', 'text', prompt]
        break
      default:
        // Treat as a custom command
        const parts = agent.split(/\s+/)
        cmd = parts[0]
        cmdArgs = [...parts.slice(1)]
        break
    }

    console.log(`\nSpawning: ${cmd} ${cmdArgs.slice(0, 2).join(' ')}...`)

    const child = spawn(cmd, cmdArgs, {
      cwd: REPO_ROOT,
      stdio: agent === 'codex' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TICKET_ID: ticket.id },
    })

    // For codex, pipe prompt to stdin
    if (agent === 'codex') {
      child.stdin?.write(prompt)
      child.stdin?.end()
    }

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 500)}`))
      }
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ${cmd}: ${err.message}`))
    })

    // Timeout: 35 minutes per ticket (large tickets need room)
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000)
      reject(new Error(`${cmd} timed out after 35 minutes`))
    }, 2_100_000)

    child.on('close', () => clearTimeout(timeout))
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'progress':
    cmdProgress(args)
    break
  case 'list':
    cmdList(args)
    break
  case 'run':
    cmdRun(args).catch((err) => {
      console.error('Fatal:', err)
      process.exit(1)
    })
    break
  case 'validate':
    cmdValidate(args)
    break
  default:
    console.log(`CollabMD Queue Runner

Usage:
  tsx scripts/queue.ts progress [--json]       Show queue status
  tsx scripts/queue.ts list [--todo] [--auto]  List tickets
  tsx scripts/queue.ts run [flags]             Run next ready ticket
  tsx scripts/queue.ts validate <ticket-id>    Run validation for a ticket

Run flags:
  --dry-run          Show what would run without executing
  --loop             Keep running until no ready tickets
  --agent <name>     Agent to use: claude (default), codex, or custom command

Environment:
  PROGRESS_MD        Path to Progress.md (default: ~/Documents/Notes/.../Progress.md)
`)
}
