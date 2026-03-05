// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

// We test the SyncNotice logic by exercising the same conditions
// the component uses. The component is inlined in doc/[id]/page.tsx
// so we extract and test the decision logic here.

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

function getSyncNoticeMessage(
  source: string | null,
  connectionStatus: ConnectionStatus,
  synced: boolean,
): string | null {
  if (connectionStatus === 'disconnected') {
    return 'reconnecting...'
  }

  if (source === 'daemon' && connectionStatus === 'connected' && !synced) {
    return 'local sync paused, editing in web'
  }

  return null
}

describe('SyncNotice logic', () => {
  it('shows reconnecting when disconnected', () => {
    expect(getSyncNoticeMessage(null, 'disconnected', false)).toBe('reconnecting...')
  })

  it('shows reconnecting when disconnected regardless of source', () => {
    expect(getSyncNoticeMessage('daemon', 'disconnected', false)).toBe('reconnecting...')
  })

  it('shows daemon paused notice when daemon doc is connected but not synced', () => {
    expect(getSyncNoticeMessage('daemon', 'connected', false)).toBe(
      'local sync paused, editing in web',
    )
  })

  it('returns null when daemon doc is fully synced', () => {
    expect(getSyncNoticeMessage('daemon', 'connected', true)).toBeNull()
  })

  it('returns null when web doc is connected and synced', () => {
    expect(getSyncNoticeMessage('web', 'connected', true)).toBeNull()
  })

  it('returns null when web doc is connected but not synced', () => {
    expect(getSyncNoticeMessage('web', 'connected', false)).toBeNull()
  })

  it('returns null when connecting (not yet disconnected)', () => {
    expect(getSyncNoticeMessage(null, 'connecting', false)).toBeNull()
  })

  it('returns null for null source when connected and synced', () => {
    expect(getSyncNoticeMessage(null, 'connected', true)).toBeNull()
  })
})
