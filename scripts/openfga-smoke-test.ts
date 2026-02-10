import { startOpenFGA, stopOpenFGA } from './openfga-dev.js'
import {
  getFgaClient,
  resetFgaClient,
  writeAuthModel,
  writeTuple,
  checkPermission,
} from '@collabmd/shared'

let passed = 0
let failed = 0

async function assert(label: string, fn: () => Promise<boolean>, expected: boolean) {
  const result = await fn()
  if (result === expected) {
    console.log(`  PASS: ${label}`)
    passed++
  } else {
    console.error(`  FAIL: ${label} (expected ${expected}, got ${result})`)
    failed++
  }
}

async function smokeTest() {
  await startOpenFGA()
  resetFgaClient()

  try {
    // Initialize store + model
    const modelId = await writeAuthModel()
    console.log(`Authorization model created: ${modelId}`)

    // Set model on client so checks use it
    const client = await getFgaClient()
    client.authorizationModelId = modelId

    // --- Seed data ---

    // Org: acme
    await writeTuple('user:alice', 'owner', 'org:acme')
    await writeTuple('user:bob', 'admin', 'org:acme')
    await writeTuple('user:charlie', 'member', 'org:acme')

    // Folder: project-x belongs to org:acme
    await writeTuple('org:acme', 'org', 'folder:project-x')
    await writeTuple('user:alice', 'owner', 'folder:project-x')

    // Document: readme in folder project-x
    await writeTuple('folder:project-x', 'parent', 'document:readme')
    await writeTuple('org:acme', 'org', 'document:readme')
    await writeTuple('user:alice', 'owner', 'document:readme')

    // Direct grants on a second doc
    await writeTuple('user:dave', 'editor', 'document:notes')
    await writeTuple('user:eve', 'commenter', 'document:notes')
    await writeTuple('user:frank', 'viewer', 'document:notes')

    // --- Test 1: Owner permissions ---
    console.log('\n--- Owner permissions ---')
    await assert('owner can_edit', () => checkPermission('alice', 'can_edit', 'document', 'readme'), true)
    await assert('owner can_comment', () => checkPermission('alice', 'can_comment', 'document', 'readme'), true)
    await assert('owner can_view', () => checkPermission('alice', 'can_view', 'document', 'readme'), true)

    // --- Test 2: Org admin -> folder editor -> document editor (inheritance) ---
    console.log('\n--- Org admin inherits editor via folder ---')
    await assert('admin can_edit folder', () => checkPermission('bob', 'can_edit', 'folder', 'project-x'), true)
    await assert('admin can_view folder', () => checkPermission('bob', 'can_view', 'folder', 'project-x'), true)
    await assert('admin can_edit doc (via folder)', () => checkPermission('bob', 'can_edit', 'document', 'readme'), true)
    await assert('admin can_comment doc (via folder)', () => checkPermission('bob', 'can_comment', 'document', 'readme'), true)
    await assert('admin can_view doc (via folder)', () => checkPermission('bob', 'can_view', 'document', 'readme'), true)

    // --- Test 3: Org member -> folder viewer -> document commenter (inheritance) ---
    console.log('\n--- Org member inherits viewer on folder, commenter on doc ---')
    await assert('member can_view folder', () => checkPermission('charlie', 'can_view', 'folder', 'project-x'), true)
    await assert('member cannot can_edit folder', () => checkPermission('charlie', 'can_edit', 'folder', 'project-x'), false)
    await assert('member can_comment doc (via folder viewer)', () => checkPermission('charlie', 'can_comment', 'document', 'readme'), true)
    await assert('member can_view doc (via folder viewer)', () => checkPermission('charlie', 'can_view', 'document', 'readme'), true)
    await assert('member cannot can_edit doc', () => checkPermission('charlie', 'can_edit', 'document', 'readme'), false)

    // --- Test 4: Direct editor on document ---
    console.log('\n--- Direct editor grants ---')
    await assert('editor can_edit', () => checkPermission('dave', 'can_edit', 'document', 'notes'), true)
    await assert('editor can_comment', () => checkPermission('dave', 'can_comment', 'document', 'notes'), true)
    await assert('editor can_view', () => checkPermission('dave', 'can_view', 'document', 'notes'), true)

    // --- Test 5: Direct commenter on document ---
    console.log('\n--- Direct commenter grants ---')
    await assert('commenter cannot can_edit', () => checkPermission('eve', 'can_edit', 'document', 'notes'), false)
    await assert('commenter can_comment', () => checkPermission('eve', 'can_comment', 'document', 'notes'), true)
    await assert('commenter can_view', () => checkPermission('eve', 'can_view', 'document', 'notes'), true)

    // --- Test 6: Direct viewer on document ---
    console.log('\n--- Direct viewer grants ---')
    await assert('viewer cannot can_edit', () => checkPermission('frank', 'can_edit', 'document', 'notes'), false)
    await assert('viewer cannot can_comment', () => checkPermission('frank', 'can_comment', 'document', 'notes'), false)
    await assert('viewer can_view', () => checkPermission('frank', 'can_view', 'document', 'notes'), true)

    // --- Test 7: No access ---
    console.log('\n--- No access ---')
    await assert('stranger cannot can_view', () => checkPermission('stranger', 'can_view', 'document', 'readme'), false)
    await assert('stranger cannot can_edit', () => checkPermission('stranger', 'can_edit', 'document', 'notes'), false)

    // --- Results ---
    console.log(`\n${passed} passed, ${failed} failed`)
    if (failed > 0) {
      throw new Error(`${failed} assertions failed`)
    }
    console.log('\nOpenFGA smoke test PASSED')
  } finally {
    stopOpenFGA()
  }
}

smokeTest().catch((err) => {
  console.error('Smoke test failed:', err)
  stopOpenFGA()
  process.exit(1)
})
