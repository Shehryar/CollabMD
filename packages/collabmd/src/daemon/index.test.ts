import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { Daemon, GlobalDaemon } from './index.js'
import type { FolderDaemon, FolderDaemonStatus } from './folder-daemon.js'

describe('Daemon', () => {
  let daemon: Daemon

  afterEach(async () => {
    if (daemon) await daemon.stop()
  })

  it('starts and exposes status endpoint', async () => {
    daemon = new Daemon({ port: 14200 })
    await daemon.start()

    expect(daemon.getState().status).toBe('running')

    const res = await fetch('http://localhost:14200/status')
    const data = (await res.json()) as {
      status: string
      startedAt: string | null
      watchedFiles: number
    }

    expect(data.status).toBe('running')
    expect(data.startedAt).toBeTruthy()
    expect(data.watchedFiles).toBe(0)
  })

  it('stops via daemon.stop()', async () => {
    daemon = new Daemon({ port: 14201 })
    await daemon.start()
    expect(daemon.getState().status).toBe('running')

    await daemon.stop()
    expect(daemon.getState().status).toBe('stopped')
  })

  it('returns 404 for unknown routes', async () => {
    daemon = new Daemon({ port: 14202 })
    await daemon.start()

    const res = await fetch('http://localhost:14202/unknown')
    expect(res.status).toBe(404)
  })
})

describe('GlobalDaemon', () => {
  class FakeFolderDaemon {
    public readonly path: string
    public readonly serverUrl: string
    public started = false
    public stopped = false

    constructor(path: string, serverUrl: string) {
      this.path = path
      this.serverUrl = serverUrl
    }

    async start(): Promise<void> {
      this.started = true
    }

    async stop(): Promise<void> {
      this.stopped = true
    }

    getStatus(): FolderDaemonStatus {
      return {
        path: this.path,
        status: this.started && !this.stopped ? 'running' : 'stopped',
        fileCount: 0,
        serverUrl: this.serverUrl,
        gitAutoCommit: false,
      }
    }
  }

  const created: FakeFolderDaemon[] = []
  let registryData: Array<{ path: string; orgId: string; serverUrl: string; addedAt: string }> = []
  const makeGlobal = () =>
    new GlobalDaemon({
      port: 14210,
      readRegistryFn: () => registryData,
      folderDaemonFactory: (project) => {
        const daemon = new FakeFolderDaemon(project.path, project.serverUrl)
        created.push(daemon)
        return daemon as unknown as FolderDaemon
      },
    })

  beforeEach(() => {
    created.length = 0
    registryData = []
  })

  it('starts folder daemons for multiple registry entries', async () => {
    registryData = [
      {
        path: '/tmp/folder-a',
        orgId: 'org-1',
        serverUrl: 'https://collabmd.dev',
        addedAt: new Date().toISOString(),
      },
      {
        path: '/tmp/folder-b',
        orgId: 'org-2',
        serverUrl: 'https://collabmd.dev',
        addedAt: new Date().toISOString(),
      },
    ]
    const global = makeGlobal()
    await global.syncProjects()

    expect(created.length).toBe(2)
    expect(created.every((daemon) => daemon.started)).toBe(true)
  })

  it('removing a folder from registry stops its daemon', async () => {
    registryData = [
      {
        path: '/tmp/folder-a',
        orgId: 'org-1',
        serverUrl: 'https://collabmd.dev',
        addedAt: new Date().toISOString(),
      },
      {
        path: '/tmp/folder-b',
        orgId: 'org-2',
        serverUrl: 'https://collabmd.dev',
        addedAt: new Date().toISOString(),
      },
    ]
    const global = makeGlobal()
    await global.syncProjects()

    const toRemove = created.find((daemon) => daemon.path === '/tmp/folder-b')
    expect(toRemove).toBeTruthy()

    registryData = [
      {
        path: '/tmp/folder-a',
        orgId: 'org-1',
        serverUrl: 'https://collabmd.dev',
        addedAt: new Date().toISOString(),
      },
    ]
    await global.syncProjects()

    expect(toRemove?.stopped).toBe(true)
  })

  it('adding a folder to registry starts a new daemon', async () => {
    registryData = [
      {
        path: '/tmp/folder-a',
        orgId: 'org-1',
        serverUrl: 'https://collabmd.dev',
        addedAt: new Date().toISOString(),
      },
    ]
    const global = makeGlobal()
    await global.syncProjects()
    expect(created.length).toBe(1)

    registryData = [
      ...registryData,
      {
        path: '/tmp/folder-c',
        orgId: 'org-3',
        serverUrl: 'https://collabmd.dev',
        addedAt: new Date().toISOString(),
      },
    ]
    await global.syncProjects()

    expect(created.length).toBe(2)
    expect(created.some((daemon) => daemon.path === '/tmp/folder-c' && daemon.started)).toBe(true)
  })
})
