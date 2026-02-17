import { basename, join } from 'path'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { LeveldbPersistence } from 'y-leveldb'
import { getCredential, type Credential } from '../auth/credentials.js'
import { TokenManager } from '../auth/token-manager.js'
import { DocMapping } from './doc-mapping.js'
import { FileWatcher } from './file-watcher.js'
import { CrdtBridge } from './crdt-bridge.js'
import { CommentBridge } from './comment-bridge.js'
import { SyncClient } from './sync-client.js'
import { GitSync } from './git-sync.js'

interface DocState {
  ydoc: Y.Doc
  awareness: Awareness
  bridge: CrdtBridge
  commentBridge: CommentBridge
  syncClient: SyncClient
}

interface PersistenceBuffer {
  updates: Uint8Array[]
  timer: NodeJS.Timeout | null
}

const PERSIST_DEBOUNCE_MS = 500
const CURSOR_IDLE_CLEAR_MS = 10_000

export interface FolderDaemonOptions {
  workDir: string
  serverUrl?: string | null
  orgId?: string | null
  tokenManager?: TokenManager | null
  sessionToken?: string | null
  userName?: string | null
  credential?: Credential | null
}

export interface FolderDaemonStatus {
  path: string
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  fileCount: number
  serverUrl: string | null
  gitAutoCommit: boolean
}

interface GitConfig {
  autoCommit?: boolean
  idleTimeout?: number
  commitMessage?: string
}

interface ProjectConfig {
  server?: string
  orgId?: string
  git?: GitConfig
}

interface ConflictsConfig {
  conflicts: string[]
  mergedAt: string
}

function loadProjectConfig(workDir: string): ProjectConfig {
  const configPath = join(workDir, 'collabmd.json')
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as ProjectConfig
  } catch {
    return {}
  }
}

export class FolderDaemon {
  private workDir: string
  private docs = new Map<string, DocState>()
  private inFlightSetups = new Map<string, Promise<void>>()
  private inFlightCreates = new Set<string>()
  private shuttingDown = false
  private docMapping: DocMapping | null = null
  private fileWatcher: FileWatcher | null = null
  private tokenManager: TokenManager | null = null
  private persistence: LeveldbPersistence | null = null
  private persistenceBuffers = new Map<string, PersistenceBuffer>()
  private serverUrl: string | null
  private orgId: string | null
  private sessionToken: string | null
  private userName: string | null
  private agentPolicy: 'enabled' | 'restricted' | 'disabled' = 'enabled'
  private cursorIdleTimers = new Map<string, NodeJS.Timeout>()
  private status: FolderDaemonStatus['status'] = 'stopped'
  private projectConfig: ProjectConfig
  private gitSync: GitSync | null = null

  constructor(options: FolderDaemonOptions) {
    this.workDir = options.workDir

    this.projectConfig = loadProjectConfig(this.workDir)
    this.serverUrl = options.serverUrl ?? this.projectConfig.server ?? null
    this.orgId = options.orgId ?? this.projectConfig.orgId ?? null

    const credential = options.credential ?? (this.serverUrl ? getCredential(this.serverUrl) : null)
    this.sessionToken = options.sessionToken ?? credential?.sessionToken ?? null
    this.userName = options.userName ?? credential?.name ?? credential?.email ?? null
    this.tokenManager = options.tokenManager ?? (
      this.serverUrl && this.sessionToken
        ? new TokenManager(this.serverUrl, this.sessionToken)
        : null
    )
  }

  async start(): Promise<void> {
    if (this.status === 'running') return

    this.status = 'starting'
    this.shuttingDown = false
    this.gitSync = new GitSync({
      workDir: this.workDir,
      enabled: this.projectConfig.git?.autoCommit === true,
      idleTimeoutMs: typeof this.projectConfig.git?.idleTimeout === 'number'
        ? this.projectConfig.git.idleTimeout * 1000
        : undefined,
      commitTemplate: typeof this.projectConfig.git?.commitMessage === 'string'
        ? this.projectConfig.git.commitMessage
        : undefined,
    })
    await this.gitSync.ready()

    if (this.serverUrl && this.sessionToken && this.orgId) {
      await this.fetchAgentPolicy()
      if (this.agentPolicy === 'disabled') {
        console.log(`[${this.workDir}] Agent editing disabled; running in watch-only mode.`)
      }
    }

    this.docMapping = new DocMapping(this.workDir)
    const cachePath = join(this.workDir, '.collabmd', 'yjs-cache')
    this.persistence = new LeveldbPersistence(cachePath)

    this.fileWatcher = new FileWatcher(this.workDir, {
      onAdd: (relativePath) => this.handleFileAdd(relativePath),
      onChange: (relativePath) => this.handleFileChange(relativePath),
      onDelete: (relativePath) => this.handleFileDelete(relativePath),
      onCommentFileChange: (relativePath) => this.handleCommentFileChange(relativePath),
    })
    await this.fileWatcher.start()

    const mappings = this.docMapping.getAllMappings()
    for (const [relativePath, docId] of Object.entries(mappings)) {
      await this.setupDoc(relativePath, docId)
    }

    this.status = 'running'
  }

  async stop(): Promise<void> {
    this.status = 'stopping'
    this.shuttingDown = true
    this.gitSync?.destroy()
    this.gitSync = null

    if (this.inFlightSetups.size > 0) {
      await Promise.allSettled(this.inFlightSetups.values())
    }

    await this.flushAllBufferedPersistenceUpdates()

    for (const [relativePath, docState] of this.docs) {
      this.clearCursorIdleTimer(relativePath)
      docState.syncClient.disconnect()
      docState.bridge.destroy()
      docState.commentBridge.destroy()
      if (this.persistence && this.docMapping) {
        const docId = this.docMapping.getDocId(relativePath)
        if (docId) {
          await this.persistence.storeUpdate(docId, Y.encodeStateAsUpdate(docState.ydoc))
        }
      }
      docState.awareness.destroy()
      docState.ydoc.destroy()
    }
    this.docs.clear()
    this.clearAllCursorIdleTimers()

    if (this.fileWatcher) {
      await this.fileWatcher.stop()
      this.fileWatcher = null
    }

    if (this.persistence) {
      await this.persistence.destroy()
      this.persistence = null
    }
    this.clearAllPersistenceBuffers()

    this.status = 'stopped'
  }

  getStatus(): FolderDaemonStatus {
    return {
      path: this.workDir,
      status: this.status,
      fileCount: this.docs.size,
      serverUrl: this.serverUrl,
      gitAutoCommit: this.gitSync?.isEnabled() ?? false,
    }
  }

  private async fetchAgentPolicy(): Promise<void> {
    if (!this.serverUrl || !this.sessionToken || !this.orgId) return
    try {
      const res = await fetch(`${this.serverUrl}/api/orgs/${this.orgId}/settings`, {
        headers: { Authorization: `Bearer ${this.sessionToken}` },
      })
      if (res.ok) {
        const data = (await res.json()) as { agentPolicy?: string }
        if (data.agentPolicy === 'disabled' || data.agentPolicy === 'restricted') {
          this.agentPolicy = data.agentPolicy
        }
      }
    } catch {
      // default enabled
    }
  }

  private async checkDocAgentEditable(docId: string): Promise<boolean> {
    if (!this.serverUrl || !this.sessionToken) return false
    try {
      const res = await fetch(`${this.serverUrl}/api/documents/${docId}`, {
        headers: { Authorization: `Bearer ${this.sessionToken}` },
      })
      if (!res.ok) return false
      const doc = (await res.json()) as { agentEditable?: boolean }
      return doc.agentEditable !== false
    } catch {
      return false
    }
  }

  private async setupDoc(relativePath: string, docId: string): Promise<void> {
    if (this.docs.has(relativePath)) return
    const inFlight = this.inFlightSetups.get(relativePath)
    if (inFlight) return inFlight

    const task = this.setupDocInternal(relativePath, docId)
      .finally(() => {
        this.inFlightSetups.delete(relativePath)
      })
    this.inFlightSetups.set(relativePath, task)
    return task
  }

  private async setupDocInternal(relativePath: string, docId: string): Promise<void> {
    if (this.shuttingDown || this.docs.has(relativePath)) return

    const ydoc = new Y.Doc()
    const awareness = new Awareness(ydoc)

    if (this.persistence) {
      try {
        const cachedDoc = await this.persistence.getYDoc(docId)
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(cachedDoc))
        cachedDoc.destroy()
      } catch {
        // no cached state
      }
    }

    const filePath = join(this.workDir, relativePath)
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
    const commentSidecarRelativePath = this.getCommentSidecarRelativePath(relativePath)
    const commentSidecarPath = join(this.workDir, commentSidecarRelativePath)
    const bridge = new CrdtBridge({
      filePath,
      relativePath,
      ydoc,
      awareness,
      fileWatcher: this.fileWatcher!,
    })
    const commentBridge = new CommentBridge({
      ydoc,
      ytext: ydoc.getText('codemirror'),
      ycomments,
      documentPath: relativePath,
      sidecarPath: commentSidecarPath,
      sidecarRelativePath: commentSidecarRelativePath,
      fileWatcher: this.fileWatcher!,
    })

    let bridgeInitialized = false
    const initializeBridge = () => {
      if (bridgeInitialized || this.shuttingDown) return
      bridgeInitialized = true
      bridge.initialize()
      commentBridge.initialize()
      if (this.persistence) {
        this.persistence.storeUpdate(docId, Y.encodeStateAsUpdate(ydoc))
      }
    }

    if (this.agentPolicy === 'disabled') {
      const syncClient = new SyncClient({
        serverUrl: '',
        docId,
        ydoc,
        awareness,
        token: '',
      })
      initializeBridge()
      this.docs.set(relativePath, { ydoc, awareness, bridge, commentBridge, syncClient })
      return
    }

    if (this.agentPolicy === 'restricted') {
      const editable = await this.checkDocAgentEditable(docId)
      if (!editable) {
        console.log(`[${this.workDir}] Skipping sync for ${relativePath}: not agent-editable`)
        const syncClient = new SyncClient({
          serverUrl: '',
          docId,
          ydoc,
          awareness,
          token: '',
        })
        initializeBridge()
        this.docs.set(relativePath, { ydoc, awareness, bridge, commentBridge, syncClient })
        return
      }
    }

    ydoc.on('update', (update: Uint8Array) => {
      this.queuePersistenceUpdate(docId, update)
    })

    let syncClient: SyncClient
    if (this.serverUrl && this.tokenManager) {
      const token = await this.tokenManager.getToken()
      syncClient = new SyncClient({
        serverUrl: this.serverUrl,
        docId,
        ydoc,
        awareness,
        token,
        userName: this.userName ?? undefined,
      })

      syncClient.once('synced', initializeBridge)
      syncClient.on('error', (err: Error) => {
        const msg = err.message || ''
        if (msg.includes('4450') || msg.includes('4451')) {
          console.log(`[${this.workDir}] Agent sync rejected for ${relativePath}: ${msg}`)
        }
      })
      syncClient.connect()
      setTimeout(() => {
        if (!syncClient.synced) initializeBridge()
      }, 5000)
    } else {
      syncClient = new SyncClient({
        serverUrl: '',
        docId,
        ydoc,
        awareness,
        token: '',
      })
      initializeBridge()
    }

    if (this.shuttingDown) {
      syncClient.disconnect()
      bridge.destroy()
      commentBridge.destroy()
      awareness.destroy()
      ydoc.destroy()
      return
    }

    this.docs.set(relativePath, { ydoc, awareness, bridge, commentBridge, syncClient })
  }

  private async handleFileAdd(relativePath: string): Promise<void> {
    this.gitSync?.notifyFileChange(relativePath)
    if (this.docs.has(relativePath) || this.inFlightCreates.has(relativePath)) return
    this.inFlightCreates.add(relativePath)

    try {
      const existingDocId = this.docMapping?.getDocId(relativePath)
      if (existingDocId) {
        await this.setupDoc(relativePath, existingDocId)
        return
      }

      if (this.serverUrl && this.sessionToken && this.orgId) {
        try {
          const title = basename(relativePath, '.md')
          const res = await fetch(`${this.serverUrl}/api/documents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.sessionToken}`,
            },
            body: JSON.stringify({ title, orgId: this.orgId, source: 'daemon' }),
          })

          if (!res.ok) {
            console.error(`[${this.workDir}] Failed to create server doc for ${relativePath}: ${res.status}`)
            return
          }

          const doc = (await res.json()) as { id: string }
          this.docMapping!.setDocId(relativePath, doc.id)
          await this.setupDoc(relativePath, doc.id)
        } catch (error) {
          console.error(`[${this.workDir}] Error creating server doc for ${relativePath}:`, error)
        }
      } else {
        const localId = `local-${crypto.randomUUID()}`
        this.docMapping!.setDocId(relativePath, localId)
        await this.setupDoc(relativePath, localId)
      }
    } finally {
      this.inFlightCreates.delete(relativePath)
    }
  }

  private handleFileChange(relativePath: string): void {
    const docState = this.docs.get(relativePath)
    if (!docState) return
    docState.bridge.onFileChange()
    this.gitSync?.notifyFileChange(relativePath)
    this.cleanupResolvedConflicts(relativePath)
    this.resetCursorIdleTimer(relativePath, docState.awareness)
  }

  private handleFileDelete(relativePath: string): void {
    this.clearCursorIdleTimer(relativePath)
    const docState = this.docs.get(relativePath)
    const docId = this.docMapping?.getDocId(relativePath)
    if (docState) {
      docState.syncClient.disconnect()
      docState.bridge.destroy()
      docState.commentBridge.destroy()
      docState.awareness.destroy()
      docState.ydoc.destroy()
      this.docs.delete(relativePath)
    }
    this.deleteCommentSidecar(relativePath)
    if (docId) this.clearPersistenceBuffer(docId)
    this.docMapping?.removeDoc(relativePath)
  }

  private handleCommentFileChange(commentRelativePath: string): void {
    const docRelativePath = this.getDocPathFromCommentSidecar(commentRelativePath)
    if (!docRelativePath) return
    const docState = this.docs.get(docRelativePath)
    if (!docState) return
    docState.commentBridge.onCommentFileChange()
  }

  private queuePersistenceUpdate(docId: string, update: Uint8Array): void {
    if (!this.persistence || this.shuttingDown) return

    let buffer = this.persistenceBuffers.get(docId)
    if (!buffer) {
      buffer = { updates: [], timer: null }
      this.persistenceBuffers.set(docId, buffer)
    }

    buffer.updates.push(update)
    if (buffer.timer) return
    buffer.timer = setTimeout(() => {
      void this.flushBufferedPersistenceUpdates(docId)
    }, PERSIST_DEBOUNCE_MS)
  }

  private async flushBufferedPersistenceUpdates(docId: string): Promise<void> {
    const buffer = this.persistenceBuffers.get(docId)
    if (!buffer) return

    if (buffer.timer) {
      clearTimeout(buffer.timer)
      buffer.timer = null
    }

    if (!this.persistence || buffer.updates.length === 0) return
    const merged = Y.mergeUpdates(buffer.updates)
    buffer.updates = []
    try {
      await this.persistence.storeUpdate(docId, merged)
    } catch {
      // keep running
    }
  }

  private async flushAllBufferedPersistenceUpdates(): Promise<void> {
    await Promise.all(Array.from(this.persistenceBuffers.keys()).map((docId) => this.flushBufferedPersistenceUpdates(docId)))
  }

  private clearPersistenceBuffer(docId: string): void {
    const buffer = this.persistenceBuffers.get(docId)
    if (!buffer) return
    if (buffer.timer) clearTimeout(buffer.timer)
    this.persistenceBuffers.delete(docId)
  }

  private clearAllPersistenceBuffers(): void {
    for (const docId of this.persistenceBuffers.keys()) {
      this.clearPersistenceBuffer(docId)
    }
  }

  private resetCursorIdleTimer(relativePath: string, awareness: Awareness): void {
    this.clearCursorIdleTimer(relativePath)
    const timer = setTimeout(() => {
      awareness.setLocalStateField('cursor', null)
      this.cursorIdleTimers.delete(relativePath)
    }, CURSOR_IDLE_CLEAR_MS)
    this.cursorIdleTimers.set(relativePath, timer)
  }

  private clearCursorIdleTimer(relativePath: string): void {
    const timer = this.cursorIdleTimers.get(relativePath)
    if (!timer) return
    clearTimeout(timer)
    this.cursorIdleTimers.delete(relativePath)
  }

  private clearAllCursorIdleTimers(): void {
    for (const key of this.cursorIdleTimers.keys()) {
      this.clearCursorIdleTimer(key)
    }
  }

  private getCommentSidecarRelativePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/')
    return `.collabmd/comments/${normalized}.comments.json`
  }

  private getDocPathFromCommentSidecar(commentRelativePath: string): string | null {
    const normalized = commentRelativePath.replace(/\\/g, '/')
    const prefix = '.collabmd/comments/'
    const suffix = '.comments.json'
    if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) return null
    return normalized.slice(prefix.length, normalized.length - suffix.length)
  }

  private deleteCommentSidecar(relativePath: string): void {
    const sidecarPath = join(this.workDir, this.getCommentSidecarRelativePath(relativePath))
    if (!existsSync(sidecarPath)) return
    try {
      unlinkSync(sidecarPath)
    } catch {
      // keep running
    }
  }

  private cleanupResolvedConflicts(relativePath: string): void {
    const conflictsPath = join(this.workDir, '.collabmd', 'conflicts.json')
    const config = this.readConflictsConfig(conflictsPath)
    if (!config || !config.conflicts.includes(relativePath)) return

    const filePath = join(this.workDir, relativePath)
    let content = ''
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      return
    }

    if (this.hasConflictMarkers(content)) return

    const remaining = config.conflicts.filter((entry) => entry !== relativePath)
    if (remaining.length === 0) {
      try {
        unlinkSync(conflictsPath)
      } catch {
        // keep running
      }
      return
    }

    const next: ConflictsConfig = {
      ...config,
      conflicts: remaining,
    }

    try {
      writeFileSync(conflictsPath, JSON.stringify(next, null, 2) + '\n')
    } catch {
      // keep running
    }
  }

  private readConflictsConfig(path: string): ConflictsConfig | null {
    if (!existsSync(path)) return null

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ConflictsConfig>
      if (!Array.isArray(parsed.conflicts) || typeof parsed.mergedAt !== 'string') return null
      return {
        conflicts: parsed.conflicts.filter((entry): entry is string => typeof entry === 'string'),
        mergedAt: parsed.mergedAt,
      }
    } catch {
      return null
    }
  }

  private hasConflictMarkers(content: string): boolean {
    return /^<{7}|^={7}|^>{7}/m.test(content)
  }
}
