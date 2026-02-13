import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { addProject } from '../daemon/registry.js'

export function linkCommand(serverUrl: string): void {
  const configPath = join(process.cwd(), 'collabmd.json')
  let config: Record<string, unknown> = {}

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      // ignore parse errors, start fresh
    }
  }

  config.server = serverUrl
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

  addProject({
    path: process.cwd(),
    orgId: typeof config.orgId === 'string' ? config.orgId : '',
    serverUrl,
    addedAt: new Date().toISOString(),
  })

  console.log(`Linked to ${serverUrl}`)
}
