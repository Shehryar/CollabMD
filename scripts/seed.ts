/**
 * Seed script: populates the local SQLite DB + OpenFGA with realistic test data.
 * Run: pnpm tsx scripts/seed.ts
 *
 * Uses sqlite3 CLI for DB inserts (avoids pnpm hoisting issues with better-sqlite3)
 * and fetch for OpenFGA tuple writes.
 */
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { resolve } from 'path'

// ── Config ──
const DB_PATH = resolve(new URL('.', import.meta.url).pathname, '../apps/web/local.db')
const FGA_URL = process.env.OPENFGA_URL ?? 'http://localhost:8081'

const USER_ID = 'dBtef6MgQdpYOZdPV9jxQ43PxBQTv9Z2'
const ORG_ID = 'rLjvwl2l1uhHVQYDWCtqcrTfESSPT4Gy'

// ── Helpers ──
function sql(query: string): string {
  return execSync(`sqlite3 "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim()
}

function sqlRun(query: string): void {
  execSync(`sqlite3 "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`)
}

async function getFgaStoreId(): Promise<string> {
  const res = await fetch(`${FGA_URL}/stores`)
  const data = await res.json()
  const store = data.stores.find((s: { name: string }) => s.name === 'collabmd')
  if (!store) throw new Error('No collabmd FGA store found')
  return store.id
}

async function writeFgaTuple(storeId: string, user: string, relation: string, object: string) {
  const res = await fetch(`${FGA_URL}/stores/${storeId}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: { tuple_keys: [{ user, relation, object }] },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    if (body.includes('cannot write a tuple which already exists')) return
    console.warn(`  FGA write failed: ${user} ${relation} ${object}`)
  }
}

function ts(daysAgo: number): number {
  return Math.floor((Date.now() - daysAgo * 86400000) / 1000)
}

// ── Data definitions ──

interface FolderDef {
  id: string; name: string; path: string; parentId: string | null; createdDaysAgo: number
}

interface DocDef {
  id: string; title: string; folderId: string | null
  createdDaysAgo: number; updatedDaysAgo: number; deletedDaysAgo?: number
}

const folderDefs: FolderDef[] = [
  { id: randomUUID(), name: 'Projects', path: '/Projects', parentId: null, createdDaysAgo: 30 },
  { id: randomUUID(), name: 'Notes', path: '/Notes', parentId: null, createdDaysAgo: 28 },
  { id: randomUUID(), name: 'Meeting Notes', path: '/Meeting Notes', parentId: null, createdDaysAgo: 25 },
  { id: randomUUID(), name: 'Design', path: '/Design', parentId: null, createdDaysAgo: 20 },
]

const projectsFolderId = folderDefs[0].id
folderDefs.push(
  { id: randomUUID(), name: 'CollabMD v2', path: '/Projects/CollabMD v2', parentId: projectsFolderId, createdDaysAgo: 28 },
  { id: randomUUID(), name: 'Side Projects', path: '/Projects/Side Projects', parentId: projectsFolderId, createdDaysAgo: 22 },
)

const collabmdFolderId = folderDefs[4].id
const sideProjectsFolderId = folderDefs[5].id
const notesFolderId = folderDefs[1].id
const meetingNotesFolderId = folderDefs[2].id
const designFolderId = folderDefs[3].id

const docDefs: DocDef[] = [
  // Root (no folder)
  { id: randomUUID(), title: 'Quick Scratch Pad', folderId: null, createdDaysAgo: 15, updatedDaysAgo: 0 },
  { id: randomUUID(), title: 'Reading List', folderId: null, createdDaysAgo: 20, updatedDaysAgo: 3 },

  // Projects / CollabMD v2
  { id: randomUUID(), title: 'Architecture Overview', folderId: collabmdFolderId, createdDaysAgo: 27, updatedDaysAgo: 2 },
  { id: randomUUID(), title: 'API Design', folderId: collabmdFolderId, createdDaysAgo: 26, updatedDaysAgo: 4 },
  { id: randomUUID(), title: 'Deployment Checklist', folderId: collabmdFolderId, createdDaysAgo: 18, updatedDaysAgo: 1 },
  { id: randomUUID(), title: 'Performance Benchmarks', folderId: collabmdFolderId, createdDaysAgo: 10, updatedDaysAgo: 5 },

  // Projects / Side Projects
  { id: randomUUID(), title: 'Weekend Hacks', folderId: sideProjectsFolderId, createdDaysAgo: 21, updatedDaysAgo: 7 },
  { id: randomUUID(), title: 'CLI Tool Ideas', folderId: sideProjectsFolderId, createdDaysAgo: 14, updatedDaysAgo: 6 },

  // Notes
  { id: randomUUID(), title: 'Learning Rust', folderId: notesFolderId, createdDaysAgo: 24, updatedDaysAgo: 3 },
  { id: randomUUID(), title: 'TypeScript Patterns', folderId: notesFolderId, createdDaysAgo: 22, updatedDaysAgo: 1 },
  { id: randomUUID(), title: 'CRDT Deep Dive', folderId: notesFolderId, createdDaysAgo: 16, updatedDaysAgo: 8 },

  // Meeting Notes
  { id: randomUUID(), title: 'Standup - Feb 10', folderId: meetingNotesFolderId, createdDaysAgo: 2, updatedDaysAgo: 2 },
  { id: randomUUID(), title: 'Product Review - Feb', folderId: meetingNotesFolderId, createdDaysAgo: 5, updatedDaysAgo: 5 },
  { id: randomUUID(), title: 'Sprint Retro - Jan', folderId: meetingNotesFolderId, createdDaysAgo: 14, updatedDaysAgo: 14 },

  // Design
  { id: randomUUID(), title: 'Design System v2', folderId: designFolderId, createdDaysAgo: 19, updatedDaysAgo: 2 },
  { id: randomUUID(), title: 'Brand Guidelines', folderId: designFolderId, createdDaysAgo: 18, updatedDaysAgo: 10 },

  // Trashed doc
  { id: randomUUID(), title: 'Old Draft', folderId: null, createdDaysAgo: 40, updatedDaysAgo: 35, deletedDaysAgo: 3 },
]

// ── Main ──

async function main() {
  const storeId = await getFgaStoreId()
  console.log(`FGA store: ${storeId}`)

  // Clean up existing "Untitled" documents
  const untitledRaw = sql("SELECT id FROM documents WHERE title = 'Untitled'")
  const untitledIds = untitledRaw ? untitledRaw.split('\n').filter(Boolean) : []

  if (untitledIds.length > 0) {
    console.log(`Deleting ${untitledIds.length} "Untitled" documents...`)
    sqlRun("DELETE FROM documents WHERE title = 'Untitled'")
    for (const docId of untitledIds) {
      try {
        await fetch(`${FGA_URL}/stores/${storeId}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deletes: { tuple_keys: [
              { user: `user:${USER_ID}`, relation: 'owner', object: `document:${docId}` },
              { user: `org:${ORG_ID}`, relation: 'org', object: `document:${docId}` },
            ]},
          }),
        })
      } catch { /* ignore */ }
    }
  }

  // Insert folders
  console.log('\nFolders:')
  for (const f of folderDefs) {
    const parentVal = f.parentId ? `'${f.parentId}'` : 'NULL'
    sqlRun(
      `INSERT OR IGNORE INTO folders (id, org_id, name, path, parent_id, created_by, created_at) VALUES ('${f.id}', '${ORG_ID}', '${f.name}', '${f.path}', ${parentVal}, '${USER_ID}', ${ts(f.createdDaysAgo)})`
    )
    console.log(`  ${f.path}`)

    await writeFgaTuple(storeId, `user:${USER_ID}`, 'owner', `folder:${f.id}`)
    await writeFgaTuple(storeId, `org:${ORG_ID}`, 'org', `folder:${f.id}`)
  }

  // Insert documents
  console.log('\nDocuments:')
  for (const d of docDefs) {
    const folderVal = d.folderId ? `'${d.folderId}'` : 'NULL'
    const deletedVal = d.deletedDaysAgo != null ? ts(d.deletedDaysAgo) : 'NULL'
    sqlRun(
      `INSERT OR IGNORE INTO documents (id, title, org_id, owner_id, folder_id, is_public, agent_editable, deleted_at, created_at, updated_at) VALUES ('${d.id}', '${d.title}', '${ORG_ID}', '${USER_ID}', ${folderVal}, 0, 1, ${deletedVal}, ${ts(d.createdDaysAgo)}, ${ts(d.updatedDaysAgo)})`
    )
    console.log(`  ${d.title}${d.deletedDaysAgo != null ? ' (trashed)' : ''}`)

    await writeFgaTuple(storeId, `user:${USER_ID}`, 'owner', `document:${d.id}`)
    await writeFgaTuple(storeId, `org:${ORG_ID}`, 'org', `document:${d.id}`)
    if (d.folderId) {
      await writeFgaTuple(storeId, `folder:${d.folderId}`, 'parent', `document:${d.id}`)
    }
  }

  // Ensure FGA tuples for existing "Agent Guide"
  const agentGuideId = sql("SELECT id FROM documents WHERE title = 'Agent Guide'")
  if (agentGuideId) {
    await writeFgaTuple(storeId, `user:${USER_ID}`, 'owner', `document:${agentGuideId}`)
    await writeFgaTuple(storeId, `org:${ORG_ID}`, 'org', `document:${agentGuideId}`)
    console.log(`  Agent Guide (existing, ensured FGA tuples)`)
  }

  // Create a share link
  const shareLinkId = randomUUID()
  const shareToken = randomUUID().replace(/-/g, '').slice(0, 16)
  const archDocId = docDefs.find((d) => d.title === 'Architecture Overview')!.id
  sqlRun(
    `INSERT OR IGNORE INTO share_links (id, document_id, token, permission, password_hash, expires_at, created_by, created_at) VALUES ('${shareLinkId}', '${archDocId}', '${shareToken}', 'viewer', NULL, NULL, '${USER_ID}', ${ts(5)})`
  )
  console.log(`\nShare link: /share/${shareToken} -> Architecture Overview`)

  console.log('\nDone! Seeded:')
  console.log(`  ${folderDefs.length} folders`)
  console.log(`  ${docDefs.length} documents (1 trashed)`)
  console.log(`  1 share link`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
