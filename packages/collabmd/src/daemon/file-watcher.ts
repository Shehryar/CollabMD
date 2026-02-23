import { watch, type FSWatcher } from 'chokidar'

export interface FileWatcherCallbacks {
  onAdd: (relativePath: string) => void
  onChange: (relativePath: string) => void
  onDelete: (relativePath: string) => void
  onCommentFileChange?: (relativePath: string) => void
  onDiscussionFileChange?: (relativePath: string) => void
  onAgentTriggerResponseFileChange?: (relativePath: string) => void
}

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private workDir: string
  private callbacks: FileWatcherCallbacks
  private suppressedPaths = new Set<string>()

  constructor(workDir: string, callbacks: FileWatcherCallbacks) {
    this.workDir = workDir
    this.callbacks = callbacks
  }

  async start(): Promise<void> {
    this.watcher = watch([
      '**/*.md',
      '.collabmd/comments/**/*.comments.json',
      '.collabmd/discussions/**/*.discussions.json',
      '.collabmd/agent-triggers/**/*.response.json',
    ], {
      cwd: this.workDir,
      ignored: ['node_modules/**', '.git/**', '.collabmd/yjs-cache/**'],
      awaitWriteFinish: { stabilityThreshold: 300 },
      ignoreInitial: false,
    })

    this.watcher.on('add', (path) => {
      this.handleEvent('add', path)
    })
    this.watcher.on('change', (path) => {
      this.handleEvent('change', path)
    })
    this.watcher.on('unlink', (path) => {
      this.handleEvent('unlink', path)
    })

    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', resolve)
    })
  }

  addSuppression(relativePath: string): void {
    this.suppressedPaths.add(this.normalizePath(relativePath))
  }

  removeSuppression(relativePath: string): void {
    this.suppressedPaths.delete(this.normalizePath(relativePath))
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
    this.suppressedPaths.clear()
  }

  private handleEvent(type: 'add' | 'change' | 'unlink', relativePath: string): void {
    const normalizedPath = this.normalizePath(relativePath)

    if (this.suppressedPaths.has(normalizedPath)) {
      this.suppressedPaths.delete(normalizedPath)
      return
    }

    if (this.isCommentSidecar(normalizedPath)) {
      this.callbacks.onCommentFileChange?.(normalizedPath)
      return
    }

    if (this.isDiscussionSidecar(normalizedPath)) {
      this.callbacks.onDiscussionFileChange?.(normalizedPath)
      return
    }

    if (this.isAgentTriggerResponseFile(normalizedPath)) {
      this.callbacks.onAgentTriggerResponseFileChange?.(normalizedPath)
      return
    }

    if (type === 'add') {
      this.callbacks.onAdd(normalizedPath)
      return
    }
    if (type === 'change') {
      this.callbacks.onChange(normalizedPath)
      return
    }

    this.callbacks.onDelete(normalizedPath)
  }

  private isCommentSidecar(relativePath: string): boolean {
    return relativePath.startsWith('.collabmd/comments/') && relativePath.endsWith('.comments.json')
  }

  private isDiscussionSidecar(relativePath: string): boolean {
    return relativePath.startsWith('.collabmd/discussions/') && relativePath.endsWith('.discussions.json')
  }

  private isAgentTriggerResponseFile(relativePath: string): boolean {
    return relativePath.startsWith('.collabmd/agent-triggers/') && relativePath.endsWith('.response.json')
  }

  private normalizePath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/')
  }
}
