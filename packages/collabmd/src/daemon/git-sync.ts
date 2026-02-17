import simpleGit, { type SimpleGit, type StatusResult } from 'simple-git'

export interface GitSyncOptions {
  workDir: string
  enabled: boolean
  idleTimeoutMs?: number
  commitTemplate?: string
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_COMMIT_TEMPLATE = 'collabmd: auto-save {files}'

export class GitSync {
  private readonly workDir: string
  private readonly enabled: boolean
  private readonly idleTimeoutMs: number
  private readonly commitTemplate: string
  private readonly git: SimpleGit | null
  private readonly initPromise: Promise<void>

  private active = false
  private idleTimer: NodeJS.Timeout | null = null
  private changedFiles = new Set<string>()
  private loggedNotRepo = false

  constructor(options: GitSyncOptions) {
    this.workDir = options.workDir
    this.enabled = options.enabled
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.commitTemplate = options.commitTemplate ?? DEFAULT_COMMIT_TEMPLATE
    this.git = this.enabled ? simpleGit(this.workDir) : null

    this.initPromise = this.initialize()
  }

  async ready(): Promise<void> {
    await this.initPromise
  }

  isEnabled(): boolean {
    return this.active
  }

  notifyFileChange(relativePath: string): void {
    if (!this.enabled) return

    const normalized = this.normalizePath(relativePath)
    if (!normalized.endsWith('.md')) return

    this.changedFiles.add(normalized)
    this.resetIdleTimer()
  }

  destroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private async initialize(): Promise<void> {
    if (!this.enabled || !this.git) return

    try {
      const isRepo = await this.git.checkIsRepo()
      if (!isRepo) {
        if (!this.loggedNotRepo) {
          console.log(`[git-sync] Auto-commit disabled for ${this.workDir}: not a git repository.`)
          this.loggedNotRepo = true
        }
        return
      }

      this.active = true
    } catch (error) {
      console.warn('[git-sync] Failed to initialize git auto-commit:', error)
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      void this.commitOnIdle()
    }, this.idleTimeoutMs)
  }

  private async commitOnIdle(): Promise<void> {
    this.idleTimer = null
    await this.initPromise

    if (!this.active || !this.git || this.changedFiles.size === 0) return

    try {
      const status = await this.git.status()
      const filesToCommit = this.getFilesToCommit(status)

      if (status.files.length === 0 || filesToCommit.length === 0) {
        this.changedFiles.clear()
        return
      }

      await this.git.add(filesToCommit)
      const message = this.buildCommitMessage(filesToCommit)
      const commitResult = await this.git.commit(message)

      this.changedFiles.clear()
      console.log(`[git-sync] Auto-commit created ${commitResult.commit}`)
    } catch (error) {
      console.warn('[git-sync] Auto-commit failed:', error)
    }
  }

  private getFilesToCommit(status: StatusResult): string[] {
    const changed = new Set<string>()

    for (const path of status.modified) changed.add(this.normalizePath(path))
    for (const path of status.created) changed.add(this.normalizePath(path))
    for (const path of status.not_added) changed.add(this.normalizePath(path))
    for (const path of status.staged) changed.add(this.normalizePath(path))

    for (const renamed of status.renamed) {
      changed.add(this.normalizePath(renamed.to))
    }

    for (const entry of status.files as Array<{ path?: string; index?: string; working_dir?: string }>) {
      if (!entry.path) continue
      if (entry.index === 'D' || entry.working_dir === 'D') continue
      changed.add(this.normalizePath(entry.path))
    }

    return Array.from(changed)
      .filter((path) => path.endsWith('.md') && this.changedFiles.has(path))
      .sort()
  }

  private buildCommitMessage(files: string[]): string {
    const timestamp = new Date().toISOString()
    return this.commitTemplate
      .replace(/\{files\}/g, files.join(', '))
      .replace(/\{count\}/g, String(files.length))
      .replace(/\{timestamp\}/g, timestamp)
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/')
  }
}
