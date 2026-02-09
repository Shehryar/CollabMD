import { describe, it, expect, afterEach } from 'vitest'
import { Daemon } from './index.js'

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
    const data = await res.json()

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
