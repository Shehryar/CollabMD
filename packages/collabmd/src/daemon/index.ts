import { createServer, type Server } from 'http'
import type { Socket } from 'net'

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

  constructor(options: DaemonOptions = {}) {
    this.port = options.port ?? 4200
    this.workDir = options.workDir ?? process.cwd()
  }

  async start(): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error('Daemon is already running')
    }

    this.state.status = 'starting'
    this.server = createServer((req, res) => this.handleRequest(req, res))
    this.server.on('connection', (socket) => {
      this.connections.add(socket)
      socket.on('close', () => this.connections.delete(socket))
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, () => {
        this.state.status = 'running'
        this.state.startedAt = new Date()
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return

    this.state.status = 'stopping'
    for (const socket of this.connections) {
      socket.destroy()
    }
    this.connections.clear()
    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.state.status = 'stopped'
        this.server = null
        resolve()
      })
    })
  }

  getState(): DaemonState {
    return { ...this.state }
  }

  getPort(): number {
    return this.port
  }

  getWorkDir(): string {
    return this.workDir
  }

  private handleRequest(
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse,
  ): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`)

    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200)
      res.end(
        JSON.stringify({
          status: this.state.status,
          startedAt: this.state.startedAt?.toISOString() ?? null,
          watchedFiles: this.state.watchedFiles,
          connectedUsers: this.state.connectedUsers,
          workDir: this.workDir,
          port: this.port,
        }),
      )
      return
    }

    if (req.method === 'POST' && url.pathname === '/stop') {
      res.writeHead(200)
      res.end(JSON.stringify({ message: 'shutting down' }))
      this.stop()
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  }
}
