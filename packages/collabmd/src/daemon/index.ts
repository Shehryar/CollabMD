import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { Socket } from 'net'
import { watch, type FSWatcher } from 'chokidar'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { getCredential, type Credential } from '../auth/credentials.js'
import { TokenManager } from '../auth/token-manager.js'
import { FolderDaemon, type FolderDaemonStatus } from './folder-daemon.js'
import { readRegistry, type ProjectConfig } from './registry.js'

export interface DaemonState {
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  startedAt: Date | null
  watchedFiles: number
  connectedUsers: number
}

export interface DaemonOptions {
  port?: number
  workDir?: string
}

export interface GlobalDaemonOptions {
  port?: number
  readRegistryFn?: () => ProjectConfig[]
  registryFilePath?: string
  folderDaemonFactory?: (
    project: ProjectConfig,
    shared: { tokenManager: TokenManager | null; credential: Credential | null },
  ) => FolderDaemon
}

interface ManagedFolder {
  project: ProjectConfig
  daemon: FolderDaemon
}

function defaultRegistryFilePath(): string {
  return join(homedir(), '.collabmd', 'projects.json')
}

export class Daemon {
  private server: Server | null = null
  private connections = new Set<Socket>()
  private state: DaemonState = {
    status: 'stopped',
    startedAt: null,
    watchedFiles: 0,
    connectedUsers: 0,
  }
  private port: number
  private workDir: string
  private folderDaemon: FolderDaemon | null = null

  constructor(options: DaemonOptions = {}) {
    this.port = options.port ?? 4200
    this.workDir = options.workDir ?? process.cwd()
  }

  async start(): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error('Daemon is already running')
    }

    this.state.status = 'starting'
    this.folderDaemon = new FolderDaemon({ workDir: this.workDir })
    await this.folderDaemon.start()

    this.server = createServer((req, res) => this.handleRequest(req, res))
    this.server.on('connection', (socket) => {
      this.connections.add(socket)
      socket.on('close', () => this.connections.delete(socket))
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.state.status = 'running'
        this.state.startedAt = new Date()
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    this.state.status = 'stopping'

    if (this.folderDaemon) {
      await this.folderDaemon.stop()
      this.folderDaemon = null
    }

    if (this.server) {
      for (const socket of this.connections) {
        socket.destroy()
      }
      this.connections.clear()
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.server = null
          resolve()
        })
      })
    }

    this.state.status = 'stopped'
  }

  getState(): DaemonState {
    const folderStatus = this.folderDaemon?.getStatus()
    return {
      ...this.state,
      watchedFiles: folderStatus?.fileCount ?? 0,
    }
  }

  getPort(): number {
    return this.port
  }

  getWorkDir(): string {
    return this.workDir
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`)
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'GET' && url.pathname === '/status') {
      const folderStatus = this.folderDaemon?.getStatus()
      res.writeHead(200)
      res.end(
        JSON.stringify({
          status: this.state.status,
          startedAt: this.state.startedAt?.toISOString() ?? null,
          watchedFiles: folderStatus?.fileCount ?? 0,
          connectedUsers: this.state.connectedUsers,
          workDir: this.workDir,
          port: this.port,
          server: folderStatus?.serverUrl ?? null,
        }),
      )
      return
    }

    if (req.method === 'POST' && url.pathname === '/stop') {
      res.writeHead(200)
      res.end(JSON.stringify({ message: 'shutting down' }))
      void this.stop()
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  }
}

export class GlobalDaemon {
  private server: Server | null = null
  private connections = new Set<Socket>()
  private status: DaemonState['status'] = 'stopped'
  private startedAt: Date | null = null
  private port: number
  private readRegistryFn: () => ProjectConfig[]
  private registryFilePath: string
  private registryWatcher: FSWatcher | null = null
  private folderDaemonFactory: NonNullable<GlobalDaemonOptions['folderDaemonFactory']>
  private folders = new Map<string, ManagedFolder>()
  private tokenManagers = new Map<string, TokenManager>()
  private credentials = new Map<string, Credential | null>()

  constructor(options: GlobalDaemonOptions = {}) {
    this.port = options.port ?? 4200
    this.readRegistryFn = options.readRegistryFn ?? readRegistry
    this.registryFilePath = options.registryFilePath ?? defaultRegistryFilePath()
    this.folderDaemonFactory = options.folderDaemonFactory ?? ((project, shared) => new FolderDaemon({
      workDir: project.path,
      serverUrl: project.serverUrl,
      orgId: project.orgId,
      tokenManager: shared.tokenManager,
      sessionToken: shared.credential?.sessionToken ?? null,
      userName: shared.credential?.name || shared.credential?.email || null,
      credential: shared.credential,
    }))
  }

  async start(): Promise<void> {
    if (this.status === 'running') return
    this.status = 'starting'
    this.startedAt = new Date()

    await this.syncProjects()
    this.setupRegistryWatcher()

    this.server = createServer((req, res) => this.handleRequest(req, res))
    this.server.on('connection', (socket) => {
      this.connections.add(socket)
      socket.on('close', () => this.connections.delete(socket))
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.status = 'running'
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    this.status = 'stopping'

    if (this.registryWatcher) {
      await this.registryWatcher.close()
      this.registryWatcher = null
    }

    await Promise.all(
      Array.from(this.folders.values()).map(async ({ daemon }) => {
        await daemon.stop()
      }),
    )
    this.folders.clear()

    if (this.server) {
      for (const socket of this.connections) {
        socket.destroy()
      }
      this.connections.clear()
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.server = null
          resolve()
        })
      })
    }

    this.status = 'stopped'
  }

  getFoldersStatus(): FolderDaemonStatus[] {
    return Array.from(this.folders.values()).map(({ daemon }) => daemon.getStatus())
  }

  async syncProjects(): Promise<void> {
    const nextProjects = this.readRegistryFn().map((project) => ({
      ...project,
      path: resolve(project.path),
    }))
    const nextByPath = new Map(nextProjects.map((project) => [project.path, project]))

    const removals = Array.from(this.folders.keys()).filter((path) => !nextByPath.has(path))
    for (const path of removals) {
      const folder = this.folders.get(path)
      if (!folder) continue
      await folder.daemon.stop()
      this.folders.delete(path)
    }

    for (const project of nextProjects) {
      const existing = this.folders.get(project.path)
      if (existing) {
        const changed = existing.project.serverUrl !== project.serverUrl || existing.project.orgId !== project.orgId
        if (!changed) continue
        await existing.daemon.stop()
        this.folders.delete(project.path)
      }

      const shared = this.getServerAuth(project.serverUrl)
      const daemon = this.folderDaemonFactory(project, shared)
      try {
        await daemon.start()
        this.folders.set(project.path, { project, daemon })
      } catch (error) {
        console.error(`[global-daemon] Failed to start folder ${project.path}:`, error)
      }
    }
  }

  private getServerAuth(serverUrl: string): { tokenManager: TokenManager | null; credential: Credential | null } {
    if (!serverUrl) return { tokenManager: null, credential: null }

    if (!this.credentials.has(serverUrl)) {
      this.credentials.set(serverUrl, getCredential(serverUrl))
    }
    const credential = this.credentials.get(serverUrl) ?? null
    if (!credential) {
      return { tokenManager: null, credential: null }
    }

    if (!this.tokenManagers.has(serverUrl)) {
      this.tokenManagers.set(serverUrl, new TokenManager(serverUrl, credential.sessionToken))
    }
    return {
      tokenManager: this.tokenManagers.get(serverUrl)!,
      credential,
    }
  }

  private setupRegistryWatcher(): void {
    if (this.registryWatcher) return

    this.registryWatcher = watch(this.registryFilePath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 250 },
    })
    this.registryWatcher.on('add', () => void this.syncProjects())
    this.registryWatcher.on('change', () => void this.syncProjects())
    this.registryWatcher.on('unlink', () => void this.syncProjects())
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`)
    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200)
      res.end(
        JSON.stringify({
          status: this.status,
          startedAt: this.startedAt?.toISOString() ?? null,
          folders: this.getFoldersStatus(),
        }),
      )
      return
    }

    if (req.method === 'POST' && url.pathname === '/stop') {
      res.writeHead(200)
      res.end(JSON.stringify({ message: 'shutting down' }))
      void this.stop()
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  }
}

