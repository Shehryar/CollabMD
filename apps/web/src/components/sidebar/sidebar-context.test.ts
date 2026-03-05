// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

// Test the syncing state derivation logic used by the connect/folders API
// and rendered in the sidebar. The logic determines status based on
// whether a daemon has an active connection and recency of last sync.

type FolderStatus = 'synced' | 'syncing' | 'disconnected'

interface AggregateEntry {
  hasActiveConnection: boolean
  lastSyncMs: number
}

const SYNCING_THRESHOLD_MS = 10_000

function deriveFolderStatus(entry: AggregateEntry, now: number): FolderStatus {
  if (!entry.hasActiveConnection) return 'disconnected'
  const recency = now - entry.lastSyncMs
  return recency < SYNCING_THRESHOLD_MS ? 'syncing' : 'synced'
}

describe('ConnectedFolder status derivation', () => {
  it('returns disconnected when no active connection', () => {
    expect(
      deriveFolderStatus({ hasActiveConnection: false, lastSyncMs: Date.now() }, Date.now()),
    ).toBe('disconnected')
  })

  it('returns syncing when connected and last sync is recent', () => {
    const now = Date.now()
    expect(deriveFolderStatus({ hasActiveConnection: true, lastSyncMs: now - 3000 }, now)).toBe(
      'syncing',
    )
  })

  it('returns synced when connected and last sync is older than threshold', () => {
    const now = Date.now()
    expect(deriveFolderStatus({ hasActiveConnection: true, lastSyncMs: now - 15000 }, now)).toBe(
      'synced',
    )
  })

  it('returns syncing at exactly 0ms recency', () => {
    const now = Date.now()
    expect(deriveFolderStatus({ hasActiveConnection: true, lastSyncMs: now }, now)).toBe('syncing')
  })

  it('returns synced at exactly threshold boundary', () => {
    const now = Date.now()
    expect(
      deriveFolderStatus(
        { hasActiveConnection: true, lastSyncMs: now - SYNCING_THRESHOLD_MS },
        now,
      ),
    ).toBe('synced')
  })

  it('returns syncing just below threshold', () => {
    const now = Date.now()
    expect(
      deriveFolderStatus(
        { hasActiveConnection: true, lastSyncMs: now - SYNCING_THRESHOLD_MS + 1 },
        now,
      ),
    ).toBe('syncing')
  })
})
