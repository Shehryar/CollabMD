import { spawn, type ChildProcess } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
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

async function main() {
  // Load apps/web/.env.local for PORT and auth config
  const webEnvPath = join(process.cwd(), 'apps', 'web', '.env.local')
  const webEnv = loadDotenv(webEnvPath)
  const port = process.env.PORT ?? webEnv.PORT ?? '3000'
  const authUrl = process.env.BETTER_AUTH_URL ?? webEnv.BETTER_AUTH_URL ?? `http://localhost:${port}`

  // 1. Build shared package (needed for FGA client imports)
  console.log('Building @collabmd/shared...')
  const build = spawn('pnpm', ['--filter', '@collabmd/shared', 'build'], {
    stdio: 'inherit',
    env: process.env,
  })
  await new Promise<void>((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shared build exited ${code}`))))
  })

  // 2. Start OpenFGA
  await startOpenFGA()
  resetFgaClient()

  // 3. Write authorization model
  const modelId = await writeAuthModel()
  const client = await getFgaClient()
  client.authorizationModelId = modelId
  console.log(`OpenFGA auth model written: ${modelId}`)

  // 4. Env for all child processes
  const env: NodeJS.ProcessEnv = { ...process.env, BETTER_AUTH_URL: authUrl }

  // 5. Start services
  //    - packages watch (shared, db, collabmd, create-collabmd)
  //    - sync server
  //    - web app (with explicit --port)
  console.log(`\nStarting dev servers (web :${port}, sync :4444, OpenFGA :8081)...\n`)

  spawnChild('pnpm', ['--filter', '@collabmd/shared', 'dev'], { env })
  spawnChild('pnpm', ['--filter', '@collabmd/db', 'dev'], { env })
  spawnChild('pnpm', ['--filter', 'collabmd', 'dev'], { env })
  spawnChild('pnpm', ['--filter', 'create-collabmd', 'dev'], { env })
  spawnChild('pnpm', ['--filter', '@collabmd/sync-server', 'dev'], { env })
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
