import { spawn, type ChildProcess } from 'child_process'
import { download, getBinaryPath } from './setup-openfga.js'

const OPENFGA_PORT = 8080
const OPENFGA_HTTP_PORT = 8081

let proc: ChildProcess | null = null

async function waitForReady(port: number, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/healthz`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`OpenFGA did not start within ${timeoutMs}ms`)
}

export async function startOpenFGA(): Promise<ChildProcess> {
  download()
  const binaryPath = getBinaryPath()

  console.log('Starting OpenFGA (in-memory store)...')
  proc = spawn(
    binaryPath,
    ['run', '--playground-enabled=false', `--grpc-addr=:${OPENFGA_PORT}`, `--http-addr=:${OPENFGA_HTTP_PORT}`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  proc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(`[openfga] ${line}`)
  })

  proc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(`[openfga:err] ${line}`)
  })

  proc.on('exit', (code) => {
    console.log(`OpenFGA exited with code ${code}`)
    proc = null
  })

  await waitForReady(OPENFGA_HTTP_PORT)
  console.log(`OpenFGA ready on gRPC :${OPENFGA_PORT}, HTTP :${OPENFGA_HTTP_PORT}`)
  return proc
}

export function stopOpenFGA(): void {
  if (proc) {
    console.log('Stopping OpenFGA...')
    proc.kill('SIGTERM')
    proc = null
  }
}

process.on('SIGINT', () => {
  stopOpenFGA()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopOpenFGA()
  process.exit(0)
})
