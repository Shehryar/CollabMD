/**
 * queue-lib.ts — Parser, resolver, and updater for the Progress.md ticket queue.
 *
 * Reads the human-readable Progress.md, extracts tickets + queue contract metadata,
 * resolves dependencies, and provides helpers for claiming/completing tickets.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TicketStatus = 'todo' | 'in_progress' | 'done' | 'cut' | 'blocked'
export type Autonomy = 'auto' | 'manual'

export interface Ticket {
  id: string // e.g. "T-070"
  phase: string // e.g. "Phase 7"
  phaseTitle: string // e.g. "Google Docs Import/Export"
  title: string // short title from the ticket line
  status: TicketStatus
  autonomy: Autonomy
  deps: string[] // ticket IDs this depends on
  validate: string // validation command
  note: string
  /** line number (1-based) of the checkbox line in Progress.md */
  line: number
  /** full spec text (all indented lines after the checkbox) */
  spec: string
}

export interface QueueState {
  tickets: Ticket[]
  /** raw file content for updating */
  raw: string
  filePath: string
}

export interface ProgressSummary {
  byStatus: Record<TicketStatus, number>
  byPhase: Record<string, Record<TicketStatus, number>>
  active: Ticket[]
  blocked: Ticket[]
  nextReady: Ticket | null
  total: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROGRESS_PATH = resolve(
  process.env.HOME ?? '~',
  'Documents/Notes/AI/Projects/Local-First-Collab-Docs/Progress.md'
)

const DEFAULT_VALIDATE = 'pnpm typecheck && pnpm test && pnpm build'

const CHECKBOX_RE =
  /^- \[([ x/\-])\] \*\*(?:T-\d+)(?::?\s*|[^*]*)\*\*/

const TICKET_LINE_RE =
  /^- \[([ x/\-])\] \*\*(T-\d+)[^*]*\*\*[:\s]*(.*)/

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseCheckboxStatus(marker: string): TicketStatus {
  switch (marker) {
    case 'x':
      return 'done'
    case '/':
      return 'in_progress'
    case '-':
      return 'cut'
    default:
      return 'todo'
  }
}

function statusToCheckbox(status: TicketStatus): string {
  switch (status) {
    case 'done':
      return 'x'
    case 'in_progress':
      return '/'
    case 'cut':
      return '-'
    default:
      return ' '
  }
}

/**
 * Parse the queue contract table from Progress.md.
 * Returns a map of ticket ID → metadata overrides.
 */
export function parseQueueContract(raw: string): Map<
  string,
  { autonomy: Autonomy; deps: string[]; validate: string; note: string }
> {
  const map = new Map<
    string,
    { autonomy: Autonomy; deps: string[]; validate: string; note: string }
  >()

  // Find the queue contract section
  const contractIdx = raw.indexOf('## queue contract')
  if (contractIdx === -1) return map

  const section = raw.slice(contractIdx)
  const lines = section.split('\n')

  // Find the table (starts with | ticket |)
  let tableStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\|\s*ticket\s*\|/i.test(lines[i])) {
      tableStart = i
      break
    }
  }
  if (tableStart === -1) return map

  // Skip header + separator
  for (let i = tableStart + 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('|')) break

    // Split by | but keep empty columns (don't filter)
    // "| T-020 | auto | | pnpm ... | note |" → ['', ' T-020 ', ' auto ', ' ', ' pnpm ... ', ' note ', '']
    const cols = line.split('|').map((c) => c.trim())
    // cols[0] is empty (before first |), cols[last] is empty (after last |)
    // Actual data starts at index 1
    if (cols.length < 3) continue

    const ticketId = cols[1]
    if (!ticketId.startsWith('T-')) continue

    map.set(ticketId, {
      autonomy: (cols[2] as Autonomy) || 'manual',
      deps: cols[3]
        ? cols[3]
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
        : [],
      validate: cols[4] || DEFAULT_VALIDATE,
      note: cols[5] || '',
    })
  }

  return map
}

/**
 * Parse Progress.md into structured tickets.
 */
export function parseProgressDoc(filePath?: string): QueueState {
  const fp = filePath ?? DEFAULT_PROGRESS_PATH
  const raw = readFileSync(fp, 'utf-8')
  return parseProgressDocFromString(raw, fp)
}

export function parseProgressDocFromString(
  raw: string,
  filePath: string = 'Progress.md'
): QueueState {
  const lines = raw.split('\n')
  const contract = parseQueueContract(raw)
  const tickets: Ticket[] = []

  let currentPhase = ''
  let currentPhaseTitle = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect phase headers
    const phaseMatch = line.match(
      /^## Phase (\d+[a-z]?(?:\/\d+[a-z]?)?)\s*[:\s]*(.*)/i
    )
    if (phaseMatch) {
      currentPhase = `Phase ${phaseMatch[1]}`
      currentPhaseTitle = phaseMatch[2].replace(/^[:\s]+/, '').trim()
      continue
    }

    // Also handle "## Phase 9b: Agent Experience" style
    const phaseMatch2 = line.match(/^## (Phase \d+[a-z]?)\s*[:\s]*(.*)/i)
    if (phaseMatch2 && !phaseMatch) {
      currentPhase = phaseMatch2[1]
      currentPhaseTitle = phaseMatch2[2].replace(/^[:\s]+/, '').trim()
      continue
    }

    // Detect non-phase ## headers (reset phase context)
    if (line.startsWith('## ') && !line.match(/^## Phase/i)) {
      // Sections like "## deep review findings" or "## queue contract"
      // Don't reset phase - tickets under these are their own thing
      if (line.includes('queue contract')) break // stop parsing at queue contract
      currentPhase = line.replace(/^## /, '').trim()
      currentPhaseTitle = ''
      continue
    }

    // Detect ticket lines
    const ticketMatch = line.match(TICKET_LINE_RE)
    if (ticketMatch) {
      const checkboxMarker = ticketMatch[1]
      const ticketId = ticketMatch[2]
      const titleRaw = ticketMatch[3]

      // Collect spec text (indented continuation lines)
      let spec = ''
      let j = i + 1
      while (j < lines.length) {
        const nextLine = lines[j]
        // Spec continues if indented (2+ spaces) or empty line followed by indented
        if (nextLine.match(/^\s{2,}/) || (nextLine.trim() === '' && j + 1 < lines.length && lines[j + 1]?.match(/^\s{2,}/))) {
          spec += nextLine + '\n'
          j++
        } else {
          break
        }
      }

      const meta = contract.get(ticketId)
      const baseStatus = parseCheckboxStatus(checkboxMarker)

      const ticket: Ticket = {
        id: ticketId,
        phase: currentPhase,
        phaseTitle: currentPhaseTitle,
        title: titleRaw
          .replace(/\*\*/g, '')
          .replace(/\s*--\s*.*$/, '')
          .trim(),
        status: baseStatus,
        autonomy: meta?.autonomy ?? 'manual',
        deps: meta?.deps ?? [],
        validate: meta?.validate ?? DEFAULT_VALIDATE,
        note: meta?.note ?? '',
        line: i + 1, // 1-based
        spec: spec.trim(),
      }

      tickets.push(ticket)
    }
  }

  // Mark tickets with unsatisfied deps as blocked
  const doneIds = new Set(
    tickets.filter((t) => t.status === 'done' || t.status === 'cut').map((t) => t.id)
  )
  for (const t of tickets) {
    if (t.status === 'todo' && t.deps.length > 0) {
      const unmet = t.deps.filter((d) => !doneIds.has(d))
      if (unmet.length > 0) {
        t.status = 'blocked'
        if (!t.note.includes('blocked by')) {
          t.note = `blocked by ${unmet.join(', ')}${t.note ? '; ' + t.note : ''}`
        }
      }
    }
  }

  return { tickets, raw, filePath }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Find the next ticket that's ready for autonomous execution.
 * Ready = todo + autonomy=auto + all deps done.
 */
export function findNextReady(tickets: Ticket[]): Ticket | null {
  const doneIds = new Set(
    tickets.filter((t) => t.status === 'done' || t.status === 'cut').map((t) => t.id)
  )

  for (const t of tickets) {
    if (t.status !== 'todo') continue
    if (t.autonomy !== 'auto') continue
    const unmet = t.deps.filter((d) => !doneIds.has(d))
    if (unmet.length > 0) continue
    return t
  }
  return null
}

/**
 * Find all tickets currently in progress.
 */
export function findActive(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => t.status === 'in_progress')
}

/**
 * Find all blocked tickets.
 */
export function findBlocked(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => t.status === 'blocked')
}

// ---------------------------------------------------------------------------
// Updater
// ---------------------------------------------------------------------------

/**
 * Update a ticket's status in the raw Progress.md content.
 * Returns the new file content.
 */
export function updateTicketStatus(
  raw: string,
  ticketId: string,
  newStatus: TicketStatus,
  note?: string
): string {
  const lines = raw.split('\n')
  const newCheckbox = statusToCheckbox(newStatus)

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(TICKET_LINE_RE)
    if (match && match[2] === ticketId) {
      // Replace the checkbox marker
      lines[i] = lines[i].replace(
        /^(- \[)[ x/\-](\])/,
        `$1${newCheckbox}$2`
      )
      break
    }
  }

  // If there's a note, update the queue contract table
  if (note !== undefined) {
    const contractIdx = raw.indexOf('## queue contract')
    if (contractIdx !== -1) {
      // Find and update the ticket row in the table
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`| ${ticketId} `)) {
          const cols = lines[i].split('|').map((c) => c.trim())
          // cols: ['', ticketId, autonomy, deps, validate, note, '']
          if (cols.length >= 6) {
            cols[5] = ` ${note} `
            lines[i] = cols.join(' | ').replace(/^\s*\|\s*/, '| ').replace(/\s*\|\s*$/, ' |')
            // Rebuild the line properly
            const parts = lines[i]
              .split('|')
              .map((c) => c.trim())
              .filter(Boolean)
            if (parts.length >= 5) {
              lines[i] = `| ${parts[0]} | ${parts[1]} | ${parts[2]} | ${parts[3]} | ${parts[4]} |`
            }
          }
          break
        }
      }
    }
  }

  return lines.join('\n')
}

/**
 * Write updated content back to Progress.md.
 */
export function writeProgressDoc(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf-8')
}

// ---------------------------------------------------------------------------
// Progress summary
// ---------------------------------------------------------------------------

export function getProgressSummary(tickets: Ticket[]): ProgressSummary {
  const byStatus: Record<TicketStatus, number> = {
    todo: 0,
    in_progress: 0,
    done: 0,
    cut: 0,
    blocked: 0,
  }
  const byPhase: Record<string, Record<TicketStatus, number>> = {}

  for (const t of tickets) {
    byStatus[t.status]++
    if (!byPhase[t.phase]) {
      byPhase[t.phase] = { todo: 0, in_progress: 0, done: 0, cut: 0, blocked: 0 }
    }
    byPhase[t.phase][t.status]++
  }

  return {
    byStatus,
    byPhase,
    active: findActive(tickets),
    blocked: findBlocked(tickets),
    nextReady: findNextReady(tickets),
    total: tickets.length,
  }
}

/**
 * Export summary as JSON (for dashboard consumption).
 */
export function summaryToJson(summary: ProgressSummary): string {
  return JSON.stringify(
    {
      ...summary,
      active: summary.active.map((t) => ({ id: t.id, phase: t.phase, title: t.title })),
      blocked: summary.blocked.map((t) => ({
        id: t.id,
        phase: t.phase,
        title: t.title,
        note: t.note,
      })),
      nextReady: summary.nextReady
        ? { id: summary.nextReady.id, phase: summary.nextReady.phase, title: summary.nextReady.title }
        : null,
    },
    null,
    2
  )
}

/**
 * Format summary for terminal display.
 */
export function formatProgress(summary: ProgressSummary): string {
  const lines: string[] = []

  lines.push('# Queue Progress')
  lines.push('')

  // Overall
  const { byStatus, total } = summary
  const donePercent = total > 0 ? Math.round(((byStatus.done + byStatus.cut) / total) * 100) : 0
  lines.push(
    `Total: ${total} tickets | Done: ${byStatus.done} | In Progress: ${byStatus.in_progress} | Todo: ${byStatus.todo} | Blocked: ${byStatus.blocked} | Cut: ${byStatus.cut} | ${donePercent}% complete`
  )
  lines.push('')

  // By phase
  lines.push('## By Phase')
  for (const [phase, counts] of Object.entries(summary.byPhase)) {
    const phaseTotal = Object.values(counts).reduce((a, b) => a + b, 0)
    const phaseDone = counts.done + counts.cut
    const bar = progressBar(phaseDone, phaseTotal)
    lines.push(
      `  ${phase.padEnd(25)} ${bar} ${phaseDone}/${phaseTotal}  (todo:${counts.todo} wip:${counts.in_progress} blocked:${counts.blocked})`
    )
  }
  lines.push('')

  // Active
  if (summary.active.length > 0) {
    lines.push('## Active (in_progress)')
    for (const t of summary.active) {
      lines.push(`  [/] ${t.id}: ${t.title} (${t.phase})`)
    }
    lines.push('')
  }

  // Blocked
  if (summary.blocked.length > 0) {
    lines.push('## Blocked')
    for (const t of summary.blocked) {
      lines.push(`  [!] ${t.id}: ${t.title} — ${t.note}`)
    }
    lines.push('')
  }

  // Next ready
  if (summary.nextReady) {
    lines.push(`## Next Ready: ${summary.nextReady.id} — ${summary.nextReady.title} (${summary.nextReady.phase})`)
  } else {
    lines.push('## Next Ready: (none — all auto tickets done or blocked)')
  }

  return lines.join('\n')
}

function progressBar(done: number, total: number, width: number = 20): string {
  if (total === 0) return `[${'·'.repeat(width)}]`
  const filled = Math.round((done / total) * width)
  return `[${'█'.repeat(filled)}${'·'.repeat(width - filled)}]`
}

// ---------------------------------------------------------------------------
// Agent prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a prompt for the agent to execute a ticket.
 */
export function buildAgentPrompt(ticket: Ticket, agentSetup: string): string {
  return `You are working on the CollabMD project. Here is the project context:

${agentSetup}

---

## Your Task: ${ticket.id} — ${ticket.title}

Phase: ${ticket.phase} — ${ticket.phaseTitle}

### Specification

${ticket.spec || ticket.title}

### Instructions

1. Implement the ticket as specified above.
2. Run the validation command to verify your work: \`${ticket.validate}\`
3. If tests fail, fix them before finishing.
4. Keep changes focused on this ticket only. Do not refactor unrelated code.
5. When done, summarize what you implemented in 2-3 sentences.

### Validation Command

\`\`\`bash
${ticket.validate}
\`\`\`
`
}
