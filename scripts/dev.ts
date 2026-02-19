import { spawn, type ChildProcess } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { startOpenFGA, stopOpenFGA } from './openfga-dev.js'
import { resetFgaClient, writeAuthModel, getFgaClient } from '@collabmd/shared'

const children: ChildProcess[] = []

/** Read key=value pairs from a dotenv file into an object. */
function loadDotenv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const vars: Record<string, string> = {}
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return vars
}

function spawnChild(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  const child = spawn(cmd, args, { stdio: 'inherit', env: opts?.env ?? process.env, cwd: opts?.cwd })
  children.push(child)
  return child
}

async function buildWorkspacePackage(name: string): Promise<void> {
  console.log(`Building ${name}...`)
  const build = spawn('pnpm', ['--filter', name, 'build'], {
    stdio: 'inherit',
    env: process.env,
  })
  await new Promise<void>((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} build exited ${code}`))))
  })
}

async function runWorkspaceCommand(
  filterName: string,
  script: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  console.log(`Running ${filterName}:${script}...`)
  const proc = spawn('pnpm', ['--filter', filterName, script], {
    stdio: 'inherit',
    env: env ?? process.env,
  })
  await new Promise<void>((resolve, reject) => {
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${filterName}:${script} exited ${code}`))))
  })
}

function tupleAlreadyExists(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /already exists|cannot write a tuple which already exists/i.test(error.message)
}

async function writeTupleSafe(user: string, relation: string, object: string): Promise<boolean> {
  try {
    const { writeTuple } = await import('@collabmd/shared')
    await writeTuple(user, relation, object)
    return true
  } catch (error) {
    if (tupleAlreadyExists(error)) return false
    throw error
  }
}

function parseDefaultDocPermission(metadata: string | null): 'editor' | 'commenter' | 'viewer' | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as { defaultDocPermission?: unknown }
    const perm = parsed.defaultDocPermission
    if (perm === 'editor' || perm === 'commenter' || perm === 'viewer') return perm
    return null
  } catch {
    return null
  }
}

async function rehydrateFgaTuplesFromDb(): Promise<void> {
  const dbModuleUrl = pathToFileURL(join(process.cwd(), 'packages', 'db', 'dist', 'index.js')).href
  const {
    db,
    members,
    folders,
    documents,
    organizations,
    isNull,
  } = await import(dbModuleUrl)

  const orgMembers = db
    .select({
      orgId: members.organizationId,
      userId: members.userId,
      role: members.role,
    })
    .from(members)
    .all()

  let created = 0
  const memberIdsByOrg = new Map<string, string[]>()
  for (const member of orgMembers) {
    const list = memberIdsByOrg.get(member.orgId) ?? []
    list.push(member.userId)
    memberIdsByOrg.set(member.orgId, list)

    const role = member.role === 'owner' || member.role === 'admin' ? member.role : 'member'
    if (await writeTupleSafe(`user:${member.userId}`, role, `org:${member.orgId}`)) {
      created += 1
    }
  }

  const orgDefaults = new Map<string, 'editor' | 'commenter' | 'viewer'>()
  const orgRows = db
    .select({
      id: organizations.id,
      metadata: organizations.metadata,
    })
    .from(organizations)
    .all()
  for (const org of orgRows) {
    const perm = parseDefaultDocPermission(org.metadata)
    if (perm) orgDefaults.set(org.id, perm)
  }

  const folderRows = db
    .select({
      id: folders.id,
      orgId: folders.orgId,
      createdBy: folders.createdBy,
    })
    .from(folders)
    .all()

  for (const folder of folderRows) {
    if (await writeTupleSafe(`org:${folder.orgId}`, 'org', `folder:${folder.id}`)) {
      created += 1
    }
    if (await writeTupleSafe(`user:${folder.createdBy}`, 'owner', `folder:${folder.id}`)) {
      created += 1
    }
  }

  const docRows = db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      ownerId: documents.ownerId,
      folderId: documents.folderId,
    })
    .from(documents)
    .where(isNull(documents.deletedAt))
    .all()

  for (const doc of docRows) {
    if (await writeTupleSafe(`user:${doc.ownerId}`, 'owner', `document:${doc.id}`)) {
      created += 1
    }
    if (await writeTupleSafe(`org:${doc.orgId}`, 'org', `document:${doc.id}`)) {
      created += 1
    }
    if (doc.folderId && await writeTupleSafe(`folder:${doc.folderId}`, 'parent', `document:${doc.id}`)) {
      created += 1
    }

    const defaultPerm = orgDefaults.get(doc.orgId)
    if (!defaultPerm) continue
    const memberIds = memberIdsByOrg.get(doc.orgId) ?? []
    for (const memberId of memberIds) {
      if (memberId === doc.ownerId) continue
      if (await writeTupleSafe(`user:${memberId}`, defaultPerm, `document:${doc.id}`)) {
        created += 1
      }
    }
  }

  console.log(`OpenFGA tuples rehydrated from DB: ${created} writes`)
}

async function main() {
  // Load apps/web/.env.local for PORT and auth config
  const webEnvPath = join(process.cwd(), 'apps', 'web', '.env.local')
  const webEnv = loadDotenv(webEnvPath)
  const port = process.env.PORT ?? webEnv.PORT ?? '3000'
  const authUrl = process.env.BETTER_AUTH_URL ?? webEnv.BETTER_AUTH_URL ?? `http://localhost:${port}`
  const openFgaUrl = 'http://localhost:8081'
  const databaseUrl = process.env.DATABASE_URL ?? `file:${join(process.cwd(), 'apps', 'web', 'local.db')}`
  process.env.OPENFGA_URL = openFgaUrl
  process.env.DATABASE_URL = databaseUrl

  // 1. Build shared + db packages before starting dependent services.
  //    This avoids sync-server booting against stale/missing @collabmd/db dist exports.
  await buildWorkspacePackage('@collabmd/shared')
  await buildWorkspacePackage('@collabmd/db')

  // 2. Start OpenFGA
  await startOpenFGA()
  resetFgaClient()

  // 3. Write authorization model
  const modelId = await writeAuthModel()
  const client = await getFgaClient()
  client.authorizationModelId = modelId
  console.log(`OpenFGA auth model written: ${modelId}`)
  await rehydrateFgaTuplesFromDb()

  // 4. Env for all child processes
  if (process.env.OPENFGA_URL && process.env.OPENFGA_URL !== openFgaUrl) {
    console.warn(
      `OPENFGA_URL is set to ${process.env.OPENFGA_URL}; overriding to ${openFgaUrl} for local dev.`,
    )
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BETTER_AUTH_URL: authUrl,
    OPENFGA_URL: openFgaUrl,
    DATABASE_URL: databaseUrl,
    NEXT_DIST_DIR: '.next-dev',
  }

  // 5. Ensure schema is up-to-date for the shared dev database.
  // Legacy local DBs may not have migration metadata; runtime compatibility
  // patches in @collabmd/db handle known additive columns.
  try {
    await runWorkspaceCommand('@collabmd/db', 'db:migrate', env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Skipping db:migrate for dev startup: ${message}`)
  }

  // 6. Start services
  //    - packages watch (shared, db, collabmd, create-collabmd)
  //    - sync server
  //    - web app (with explicit --port)
  console.log(
    `\nStarting dev servers (web :${port}, sync :4444, OpenFGA :8081, OPENFGA_URL=${openFgaUrl}, DATABASE_URL=${databaseUrl}, NEXT_DIST_DIR=.next-dev)...\n`,
  )

  spawnChild('pnpm', ['--filter', '@collabmd/shared', 'dev'], { env })
  spawnChild('pnpm', ['--filter', '@collabmd/db', 'dev'], { env })
  spawnChild('pnpm', ['--filter', 'collabmd', 'dev'], { env })
  spawnChild('pnpm', ['--filter', 'create-collabmd', 'dev'], { env })
  // Run sync server from repo root to avoid Node 25 + tsx + pnpm symlink bug
  // (named ESM exports from workspace packages fail when tsx runs from the package dir)
  spawnChild('npx', ['tsx', 'watch', 'apps/sync-server/src/index.ts'], { env })
  spawnChild('pnpm', ['--filter', '@collabmd/web', 'exec', 'next', 'dev', '--port', port], { env })
}

function cleanup() {
  for (const child of children) {
    child.kill('SIGTERM')
  }
  children.length = 0
  stopOpenFGA()
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

main().catch((err) => {
  console.error('dev startup failed:', err)
  cleanup()
})
