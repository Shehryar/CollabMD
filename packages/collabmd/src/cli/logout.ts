import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { clearCredential } from '../auth/credentials.js'

export function logoutCommand(serverUrl?: string): void {
  const url = serverUrl || getServerUrlFromConfig()
  if (!url) {
    console.log('No server configured. Use collabmd link <url> first, or pass --server <url>')
    return
  }
  clearCredential(url)
  console.log('Logged out')
}

function getServerUrlFromConfig(): string | null {
  const configPath = join(process.cwd(), 'collabmd.json')
  if (!existsSync(configPath)) return null
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return config.server || null
  } catch {
    return null
  }
}
