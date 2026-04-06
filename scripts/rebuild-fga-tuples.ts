/**
 * WARNING: This script reconstructs BASELINE tuples only.
 * It recovers: ownership, org membership, folder containment, org-level defaults.
 * It does NOT recover: explicit per-user document/folder shares.
 * To get full recovery, deploy the permission_audit_log table first,
 * then replay from the audit log instead of using this script.
 */

import { join } from 'path'
import { pathToFileURL } from 'url'

type DefaultDocPermission = 'editor' | 'commenter' | 'viewer'
type TupleKey = { user: string; relation: string; object: string }

interface RebuildPlan {
  documentCount: number
  folderCount: number
  membershipCount: number
  tuples: TupleKey[]
}

let cachedDbModule: Promise<any> | null = null
let cachedSharedModule: Promise<any> | null = null

interface CliFlags {
  dryRun: boolean
  reset: boolean
}

function parseFlags(argv: string[]): CliFlags {
  return {
    dryRun: argv.includes('--dry-run'),
    reset: argv.includes('--reset'),
  }
}

function ensureEnvironment(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  process.env.OPENFGA_URL =
    process.env.OPENFGA_API_URL ?? process.env.OPENFGA_URL ?? 'http://localhost:8080'
}

function parseDefaultDocPermission(metadata: string | null): DefaultDocPermission | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as { defaultDocPermission?: unknown }
    const value = parsed.defaultDocPermission
    if (value === 'editor' || value === 'commenter' || value === 'viewer') {
      return value
    }
    return null
  } catch {
    return null
  }
}

function tupleAlreadyExists(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /already exists|cannot write a tuple which already exists/i.test(error.message)
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function getDbModule() {
  if (!cachedDbModule) {
    const dbModuleUrl = pathToFileURL(join(process.cwd(), 'packages', 'db', 'dist', 'index.js')).href
    cachedDbModule = import(dbModuleUrl)
  }
  return cachedDbModule
}

async function getSharedModule() {
  if (!cachedSharedModule) {
    const sharedModuleUrl = pathToFileURL(
      join(process.cwd(), 'packages', 'shared', 'dist', 'index.js'),
    ).href
    cachedSharedModule = import(sharedModuleUrl)
  }
  return cachedSharedModule
}

async function buildPlan(): Promise<RebuildPlan> {
  const { db, documents, folders, members, organizations, isNull } = await getDbModule()

  const [memberRows, folderRows, documentRows, orgRows] = await Promise.all([
    db
      .select({
        orgId: members.organizationId,
        userId: members.userId,
        role: members.role,
      })
      .from(members)
      .all(),
    db
      .select({
        id: folders.id,
        orgId: folders.orgId,
        createdBy: folders.createdBy,
      })
      .from(folders)
      .all(),
    db
      .select({
        id: documents.id,
        orgId: documents.orgId,
        ownerId: documents.ownerId,
        folderId: documents.folderId,
      })
      .from(documents)
      .where(isNull(documents.deletedAt))
      .all(),
    db
      .select({
        id: organizations.id,
        metadata: organizations.metadata,
      })
      .from(organizations)
      .all(),
  ])

  const tuples: TupleKey[] = []
  const tupleKeys = new Set<string>()
  const memberIdsByOrg = new Map<string, string[]>()
  const defaultPermByOrg = new Map<string, DefaultDocPermission>()

  const addTuple = (tuple: TupleKey) => {
    const key = `${tuple.user}|${tuple.relation}|${tuple.object}`
    if (tupleKeys.has(key)) return
    tupleKeys.add(key)
    tuples.push(tuple)
  }

  for (const org of orgRows) {
    const permission = parseDefaultDocPermission(org.metadata)
    if (permission) defaultPermByOrg.set(org.id, permission)
  }

  for (const member of memberRows) {
    const orgMembers = memberIdsByOrg.get(member.orgId) ?? []
    orgMembers.push(member.userId)
    memberIdsByOrg.set(member.orgId, orgMembers)

    const role = member.role === 'owner' || member.role === 'admin' ? member.role : 'member'
    addTuple({
      user: `user:${member.userId}`,
      relation: role,
      object: `org:${member.orgId}`,
    })
  }

  for (const folder of folderRows) {
    addTuple({ user: `user:${folder.createdBy}`, relation: 'owner', object: `folder:${folder.id}` })
    addTuple({ user: `org:${folder.orgId}`, relation: 'org', object: `folder:${folder.id}` })
  }

  for (const document of documentRows) {
    addTuple({
      user: `user:${document.ownerId}`,
      relation: 'owner',
      object: `document:${document.id}`,
    })
    addTuple({ user: `org:${document.orgId}`, relation: 'org', object: `document:${document.id}` })

    if (document.folderId) {
      addTuple({
        user: `folder:${document.folderId}`,
        relation: 'parent',
        object: `document:${document.id}`,
      })
    }

    const defaultPerm = defaultPermByOrg.get(document.orgId)
    if (!defaultPerm) continue

    for (const memberId of memberIdsByOrg.get(document.orgId) ?? []) {
      if (memberId === document.ownerId) continue
      addTuple({
        user: `user:${memberId}`,
        relation: defaultPerm,
        object: `document:${document.id}`,
      })
    }
  }

  return {
    documentCount: documentRows.length,
    folderCount: folderRows.length,
    membershipCount: memberRows.length,
    tuples,
  }
}

async function readAllTuples(): Promise<TupleKey[]> {
  const { getFgaClient } = await getSharedModule()
  const client = await getFgaClient()
  const tuples: TupleKey[] = []
  let continuationToken: string | undefined

  do {
    const page = await client.read(undefined, {
      pageSize: 100,
      continuationToken,
    })

    for (const tuple of page.tuples ?? []) {
      tuples.push({
        user: tuple.key.user,
        relation: tuple.key.relation,
        object: tuple.key.object,
      })
    }

    continuationToken = page.continuation_token || undefined
  } while (continuationToken)

  return tuples
}

async function resetAllTuples(): Promise<number> {
  const { getFgaClient } = await getSharedModule()
  const client = await getFgaClient()
  const existingTuples = await readAllTuples()

  for (const tupleBatch of chunk(existingTuples, 100)) {
    await client.deleteTuples(tupleBatch, {
      transaction: { maxPerChunk: 100, maxParallelRequests: 4 },
    })
  }

  return existingTuples.length
}

async function writeMissingTuple(tuple: TupleKey): Promise<'written' | 'skipped'> {
  const { getFgaClient } = await getSharedModule()
  const client = await getFgaClient()
  try {
    await client.write(
      { writes: [tuple] },
      { transaction: { maxPerChunk: 1, maxParallelRequests: 1 } },
    )
    return 'written'
  } catch (error) {
    if (tupleAlreadyExists(error)) return 'skipped'
    throw error
  }
}

async function main() {
  ensureEnvironment()
  const flags = parseFlags(process.argv.slice(2))
  const plan = await buildPlan()

  console.log(`OpenFGA URL: ${process.env.OPENFGA_URL}`)
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL}`)
  console.log(
    `Plan: ${plan.documentCount} documents, ${plan.folderCount} folders, ${plan.membershipCount} org memberships, ${plan.tuples.length} tuples`,
  )

  if (flags.dryRun) {
    if (flags.reset) {
      const existing = await readAllTuples()
      console.log(`Dry run: would reset ${existing.length} existing tuples before rebuild.`)
    }

    for (const tuple of plan.tuples) {
      console.log(`[dry-run] ${tuple.user} ${tuple.relation} ${tuple.object}`)
    }

    console.log(
      `Dry run complete: ${plan.documentCount} documents, ${plan.folderCount} folders, 0 tuples written, ${plan.tuples.length} pending writes.`,
    )
    return
  }

  let deleted = 0
  if (flags.reset) {
    deleted = await resetAllTuples()
    console.log(`Reset OpenFGA store: deleted ${deleted} existing tuples.`)
  }

  let written = 0
  let skipped = 0
  for (const tuple of plan.tuples) {
    const status = await writeMissingTuple(tuple)
    if (status === 'written') {
      written += 1
    } else {
      skipped += 1
    }
  }

  console.log(
    `Rebuild complete: ${plan.documentCount} documents, ${plan.folderCount} folders, ${written} tuples written, ${skipped} skipped.` +
      (flags.reset ? ` ${deleted} tuples were deleted during reset.` : ''),
  )
}

main().catch((error) => {
  console.error('Failed to rebuild OpenFGA tuples:', error)
  process.exit(1)
})
