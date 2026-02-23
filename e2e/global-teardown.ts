import path from 'path'
import fs from 'fs'

const testDbPath = path.join(__dirname, '..', 'apps', 'web', 'test.db')
const pidFile = path.join(__dirname, '.openfga.pid')

export default async function globalTeardown() {
  // Stop OpenFGA using saved PID
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
      process.kill(pid, 'SIGTERM')
      console.log(`[e2e] Stopped OpenFGA (pid=${pid})`)
    } catch {
      // process already gone
    }
    fs.unlinkSync(pidFile)
  }

  // Clean up test DB files
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    const file = testDbPath + suffix
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file)
      } catch {
        // best effort
      }
    }
  }
}
