import path from 'path'
import fs from 'fs'
import { execSync, spawn } from 'child_process'

const testDbPath = path.join(__dirname, '..', 'apps', 'web', 'test.db')
const rootDir = path.join(__dirname, '..')
const dbPkgDir = path.join(rootDir, 'packages', 'db')
const pidFile = path.join(__dirname, '.openfga.pid')

const FGA_HTTP_PORT = 8082
const FGA_GRPC_PORT = 8083

function getBinaryPath(): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(rootDir, 'node_modules', '.cache', 'openfga', `openfga${ext}`)
}

async function waitForReady(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/healthz`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`OpenFGA did not start within ${timeoutMs}ms`)
}

async function startOpenFGA(): Promise<number> {
  // Ensure binary is downloaded
  execSync('npx tsx scripts/setup-openfga.ts', { cwd: rootDir, stdio: 'inherit' })

  const binaryPath = getBinaryPath()
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`OpenFGA binary not found at ${binaryPath}`)
  }

  console.log('[e2e] Starting OpenFGA...')
  const proc = spawn(
    binaryPath,
    [
      'run',
      '--playground-enabled=false',
      `--grpc-addr=:${FGA_GRPC_PORT}`,
      `--http-addr=:${FGA_HTTP_PORT}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  )

  proc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(`[e2e:openfga] ${line}`)
  })

  proc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(`[e2e:openfga:err] ${line}`)
  })

  proc.unref()

  await waitForReady(FGA_HTTP_PORT)
  console.log(`[e2e] OpenFGA ready on HTTP :${FGA_HTTP_PORT} (pid=${proc.pid})`)
  return proc.pid!
}

async function createStoreAndWriteModel(): Promise<void> {
  const baseUrl = `http://localhost:${FGA_HTTP_PORT}`

  // Find or create store
  const storesRes = await fetch(`${baseUrl}/stores`)
  const storesBody = (await storesRes.json()) as {
    stores?: Array<{ id: string; name: string }>
  }
  let storeId = storesBody.stores?.find((s) => s.name === 'collabmd')?.id

  if (!storeId) {
    const createRes = await fetch(`${baseUrl}/stores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'collabmd' }),
    })
    const created = (await createRes.json()) as { id: string }
    storeId = created.id
  }

  // Read auth model
  const modelPath = path.join(rootDir, 'packages', 'shared', 'src', 'fga', 'model.json')
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf-8'))

  // Write auth model
  const modelRes = await fetch(`${baseUrl}/stores/${storeId}/authorization-models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  })

  if (!modelRes.ok) {
    const text = await modelRes.text()
    throw new Error(`Failed to write auth model: ${modelRes.status} ${text}`)
  }

  console.log('[e2e] OpenFGA auth model written')
}

export default async function globalSetup() {
  // 1. Clean slate: delete test DB if exists
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    const file = testDbPath + suffix
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }

  // Clean up stale PID file
  if (fs.existsSync(pidFile)) {
    try {
      const oldPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
      process.kill(oldPid, 'SIGTERM')
    } catch {
      // process already gone
    }
    fs.unlinkSync(pidFile)
  }

  // 2. Start OpenFGA
  const pid = await startOpenFGA()
  fs.writeFileSync(pidFile, String(pid))

  // 3. Write auth model via HTTP
  await createStoreAndWriteModel()

  // 4. Create test DB schema using drizzle-kit push (avoids migration conflicts)
  execSync(`npx drizzle-kit push --force`, {
    cwd: dbPkgDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: `file:${testDbPath}`,
    },
  })
  console.log('[e2e] Database schema pushed')
}
