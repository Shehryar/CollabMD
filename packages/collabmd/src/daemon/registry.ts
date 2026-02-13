import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

export interface ProjectConfig {
  path: string
  orgId: string
  serverUrl: string
  addedAt: string
}

function registryPath(): string {
  return join(homedir(), '.collabmd', 'projects.json')
}

function normalizePath(path: string): string {
  return resolve(path)
}

export function readRegistry(): ProjectConfig[] {
  const file = registryPath()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is ProjectConfig => {
        if (!entry || typeof entry !== 'object') return false
        const project = entry as Partial<ProjectConfig>
        return (
          typeof project.path === 'string'
          && typeof project.orgId === 'string'
          && typeof project.serverUrl === 'string'
          && typeof project.addedAt === 'string'
        )
      })
      .map((entry) => ({
        ...entry,
        path: normalizePath(entry.path),
      }))
  } catch {
    return []
  }
}

export function writeRegistry(entries: ProjectConfig[]): void {
  const file = registryPath()
  const dir = dirname(file)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const normalized = entries.map((entry) => ({
    ...entry,
    path: normalizePath(entry.path),
  }))
  const tmpFile = `${file}.tmp`
  writeFileSync(tmpFile, JSON.stringify(normalized, null, 2) + '\n')
  renameSync(tmpFile, file)
}

export function addProject(config: ProjectConfig): void {
  const current = readRegistry()
  const normalizedPath = normalizePath(config.path)
  const index = current.findIndex((entry) => normalizePath(entry.path) === normalizedPath)
  const next: ProjectConfig = { ...config, path: normalizedPath }

  if (index === -1) {
    current.push(next)
  } else {
    current[index] = next
  }

  writeRegistry(current)
}

export function removeProject(path: string): void {
  const normalizedPath = normalizePath(path)
  const current = readRegistry()
  const next = current.filter((entry) => normalizePath(entry.path) !== normalizedPath)
  writeRegistry(next)
}

export function getProject(path: string): ProjectConfig | undefined {
  const normalizedPath = normalizePath(path)
  return readRegistry().find((entry) => normalizePath(entry.path) === normalizedPath)
}

