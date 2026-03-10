import { describe, it, expect } from 'vitest'
import {
  parseProgressDocFromString,
  parseQueueContract,
  findNextReady,
  findBlocked,
  findActive,
  getProgressSummary,
  updateTicketStatus,
  formatProgress,
  summaryToJson,
  buildAgentPrompt,
} from './queue-lib.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_DOC = `# CollabMD: Progress

status key: \`[ ]\` todo, \`[/]\` in progress, \`[x]\` done, \`[-]\` cut

---

## Phase 0: Scaffold
> get the monorepo set up

- [x] **T-001**: Initialize monorepo
  - pnpm workspaces, turborepo
- [x] **T-002**: Set up Drizzle schema

---

## Phase 1: Core Editor
> editor + collab

- [x] **T-010**: Basic Next.js app with CodeMirror
- [/] **T-011**: Yjs integration
  - Y.Doc with Y.Text
- [ ] **T-012**: y-websocket sync server
  - room-per-document model
  - health check
- [-] **T-013**: Wire editor (cut)

---

## Phase 2: Auth
> auth + permissions

- [ ] **T-020**: Better Auth setup
- [ ] **T-021**: Org plugin
  - depends on T-020

---

## queue contract

machine-readable metadata for the autonomous ticket runner.

| ticket | autonomy | deps | validate | note |
|--------|----------|------|----------|------|
| T-012 | auto | T-010,T-011 | pnpm typecheck && pnpm test | sync server |
| T-020 | auto | | pnpm typecheck && pnpm test | auth setup |
| T-021 | manual | T-020 | pnpm typecheck && pnpm test | needs human review |
`

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('parseProgressDocFromString', () => {
  it('extracts all tickets with correct IDs', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const ids = tickets.map((t) => t.id)
    expect(ids).toEqual(['T-001', 'T-002', 'T-010', 'T-011', 'T-012', 'T-013', 'T-020', 'T-021'])
  })

  it('parses checkbox status correctly', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const statusMap = Object.fromEntries(tickets.map((t) => [t.id, t.status]))
    expect(statusMap['T-001']).toBe('done')
    expect(statusMap['T-011']).toBe('in_progress')
    expect(statusMap['T-012']).toBe('blocked') // T-011 is in_progress (not done), so blocked
    expect(statusMap['T-013']).toBe('cut')
    expect(statusMap['T-020']).toBe('todo')
  })

  it('assigns phase and phaseTitle', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const t001 = tickets.find((t) => t.id === 'T-001')!
    expect(t001.phase).toBe('Phase 0')
    expect(t001.phaseTitle).toContain('Scaffold')

    const t020 = tickets.find((t) => t.id === 'T-020')!
    expect(t020.phase).toBe('Phase 2')
  })

  it('collects spec text from indented continuation', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const t012 = tickets.find((t) => t.id === 'T-012')!
    expect(t012.spec).toContain('room-per-document model')
    expect(t012.spec).toContain('health check')
  })

  it('marks tickets with unsatisfied deps as blocked', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    // T-012 deps: T-010 (done), T-011 (in_progress) — T-011 is NOT done, so blocked
    const t012 = tickets.find((t) => t.id === 'T-012')!
    expect(t012.status).toBe('blocked')
    expect(t012.note).toContain('T-011')
  })

  it('stops parsing at queue contract section', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    // Should not parse anything from the queue contract table as tickets
    expect(tickets.every((t) => t.id.startsWith('T-'))).toBe(true)
    expect(tickets.length).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// Queue contract parser
// ---------------------------------------------------------------------------

describe('parseQueueContract', () => {
  it('extracts metadata from the contract table', () => {
    const contract = parseQueueContract(MINIMAL_DOC)
    expect(contract.size).toBe(3)

    const t012 = contract.get('T-012')!
    expect(t012.autonomy).toBe('auto')
    expect(t012.deps).toEqual(['T-010', 'T-011'])
    expect(t012.validate).toBe('pnpm typecheck && pnpm test')
    expect(t012.note).toBe('sync server')
  })

  it('parses autonomy correctly', () => {
    const contract = parseQueueContract(MINIMAL_DOC)
    expect(contract.get('T-020')!.autonomy).toBe('auto')
    expect(contract.get('T-021')!.autonomy).toBe('manual')
  })

  it('handles empty deps', () => {
    const contract = parseQueueContract(MINIMAL_DOC)
    expect(contract.get('T-020')!.deps).toEqual([])
  })

  it('returns empty map when no contract section', () => {
    const contract = parseQueueContract('# Just a title\n\nSome content.')
    expect(contract.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Resolver tests
// ---------------------------------------------------------------------------

describe('findNextReady', () => {
  it('returns null when no auto+todo tickets exist', () => {
    const { tickets } = parseProgressDocFromString(`# Test
## Phase 1: Test
- [x] **T-001**: Done ticket

---

## queue contract
| ticket | autonomy | deps | validate | note |
|--------|----------|------|----------|------|
`)
    expect(findNextReady(tickets)).toBeNull()
  })

  it('skips blocked tickets', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    // T-012 is auto but blocked (T-011 not done)
    // T-020 is auto with no deps → should be next
    const next = findNextReady(tickets)
    expect(next).not.toBeNull()
    expect(next!.id).toBe('T-020')
  })

  it('skips manual tickets', () => {
    const doc = `# Test
## Phase 1: Test
- [ ] **T-001**: Manual ticket
- [ ] **T-002**: Auto ticket

---

## queue contract
| ticket | autonomy | deps | validate | note |
|--------|----------|------|----------|------|
| T-001 | manual | | | |
| T-002 | auto | | | |
`
    const { tickets } = parseProgressDocFromString(doc)
    const next = findNextReady(tickets)
    expect(next!.id).toBe('T-002')
  })

  it('respects dependency ordering', () => {
    const doc = `# Test
## Phase 1: Test
- [x] **T-001**: First done
- [ ] **T-002**: Second (depends on T-001)
- [ ] **T-003**: Third (depends on T-002)

---

## queue contract
| ticket | autonomy | deps | validate | note |
|--------|----------|------|----------|------|
| T-002 | auto | T-001 | | |
| T-003 | auto | T-002 | | |
`
    const { tickets } = parseProgressDocFromString(doc)
    const next = findNextReady(tickets)
    expect(next!.id).toBe('T-002') // T-003 blocked by T-002
  })
})

describe('findBlocked', () => {
  it('returns tickets with unsatisfied deps', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const blocked = findBlocked(tickets)
    expect(blocked.some((t) => t.id === 'T-012')).toBe(true)
  })
})

describe('findActive', () => {
  it('returns in_progress tickets', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const active = findActive(tickets)
    expect(active.length).toBe(1)
    expect(active[0].id).toBe('T-011')
  })
})

// ---------------------------------------------------------------------------
// Updater tests
// ---------------------------------------------------------------------------

describe('updateTicketStatus', () => {
  it('changes checkbox from todo to in_progress', () => {
    const updated = updateTicketStatus(MINIMAL_DOC, 'T-020', 'in_progress')
    expect(updated).toContain('- [/] **T-020**')
    expect(updated).not.toContain('- [ ] **T-020**')
  })

  it('changes checkbox from todo to done', () => {
    const updated = updateTicketStatus(MINIMAL_DOC, 'T-020', 'done')
    expect(updated).toContain('- [x] **T-020**')
  })

  it('preserves other tickets unchanged', () => {
    const updated = updateTicketStatus(MINIMAL_DOC, 'T-020', 'done')
    // T-001 should still be done
    expect(updated).toContain('- [x] **T-001**')
    // T-011 should still be in_progress
    expect(updated).toContain('- [/] **T-011**')
    // T-012 should still be todo
    expect(updated).toContain('- [ ] **T-012**')
  })

  it('handles reverting done to todo', () => {
    const updated = updateTicketStatus(MINIMAL_DOC, 'T-001', 'todo')
    expect(updated).toContain('- [ ] **T-001**')
  })
})

// ---------------------------------------------------------------------------
// Progress summary tests
// ---------------------------------------------------------------------------

describe('getProgressSummary', () => {
  it('counts statuses correctly', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const summary = getProgressSummary(tickets)

    expect(summary.total).toBe(8)
    expect(summary.byStatus.done).toBe(3) // T-001, T-002, T-010
    expect(summary.byStatus.in_progress).toBe(1) // T-011
    expect(summary.byStatus.cut).toBe(1) // T-013
    // T-012 is blocked, T-020 is todo, T-021 is todo (deps on T-020 which is not done → blocked)
  })

  it('identifies active tickets', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const summary = getProgressSummary(tickets)
    expect(summary.active.length).toBe(1)
    expect(summary.active[0].id).toBe('T-011')
  })

  it('identifies next ready ticket', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const summary = getProgressSummary(tickets)
    expect(summary.nextReady).not.toBeNull()
    expect(summary.nextReady!.id).toBe('T-020')
  })
})

describe('formatProgress', () => {
  it('produces human-readable output', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const summary = getProgressSummary(tickets)
    const output = formatProgress(summary)
    expect(output).toContain('Queue Progress')
    expect(output).toContain('Phase 0')
    expect(output).toContain('Phase 1')
    expect(output).toContain('T-011')
    expect(output).toContain('Next Ready')
  })
})

describe('summaryToJson', () => {
  it('produces valid JSON', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const summary = getProgressSummary(tickets)
    const json = summaryToJson(summary)
    const parsed = JSON.parse(json)
    expect(parsed.total).toBe(8)
    expect(parsed.byStatus).toBeDefined()
    expect(parsed.nextReady).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Agent prompt builder
// ---------------------------------------------------------------------------

describe('buildAgentPrompt', () => {
  it('includes ticket ID and spec', () => {
    const { tickets } = parseProgressDocFromString(MINIMAL_DOC)
    const t012 = tickets.find((t) => t.id === 'T-012')!
    const prompt = buildAgentPrompt(t012, 'Agent setup context here')
    expect(prompt).toContain('T-012')
    expect(prompt).toContain('room-per-document model')
    expect(prompt).toContain('Agent setup context here')
    expect(prompt).toContain('pnpm typecheck && pnpm test')
  })
})

// ---------------------------------------------------------------------------
// Dry-run behavior (runner does not crash without agent)
// ---------------------------------------------------------------------------

describe('runner integration', () => {
  it('full parse → resolve → update cycle works on fixture doc', () => {
    const state = parseProgressDocFromString(MINIMAL_DOC)
    const next = findNextReady(state.tickets)
    expect(next).not.toBeNull()

    // Claim it
    const updated = updateTicketStatus(state.raw, next!.id, 'in_progress')
    const reparse = parseProgressDocFromString(updated)
    const claimed = reparse.tickets.find((t) => t.id === next!.id)!
    expect(claimed.status).toBe('in_progress')

    // Complete it
    const completed = updateTicketStatus(updated, next!.id, 'done')
    const final = parseProgressDocFromString(completed)
    const done = final.tickets.find((t) => t.id === next!.id)!
    expect(done.status).toBe('done')

    // Now T-021 should still be blocked (deps on T-020 which just became done)
    // Actually T-020 was next, and now it's done, so T-021's dep is satisfied
    // But T-021 is manual, so findNextReady won't pick it
    const nextAfter = findNextReady(final.tickets)
    // T-012 is still blocked (T-011 in_progress), T-021 is manual
    expect(nextAfter).toBeNull()
  })
})
