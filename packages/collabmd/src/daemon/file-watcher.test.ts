import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { FileWatcher } from './file-watcher.js'

// Mock chokidar — emit events manually for deterministic tests
let mockWatcher: MockFSWatcher

class MockFSWatcher extends EventEmitter {
  close = vi.fn().mockResolvedValue(undefined)
}

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    mockWatcher = new MockFSWatcher()
    queueMicrotask(() => mockWatcher.emit('ready'))
    return mockWatcher
  }),
}))

describe('FileWatcher', () => {
  let watcher: FileWatcher

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls onAdd for add events', async () => {
    const added: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: (path) => added.push(path),
      onChange: () => {},
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    mockWatcher.emit('add', 'test.md')

    expect(added).toEqual(['test.md'])
  })

  it('calls onChange for change events', async () => {
    const changed: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: (path) => changed.push(path),
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    mockWatcher.emit('change', 'existing.md')

    expect(changed).toEqual(['existing.md'])
  })

  it('calls onDelete for unlink events', async () => {
    const deleted: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: () => {},
      onDelete: (path) => deleted.push(path),
      onCommentFileChange: () => {},
    })
    await watcher.start()

    mockWatcher.emit('unlink', 'removed.md')

    expect(deleted).toEqual(['removed.md'])
  })

  it('suppresses add events for suppressed paths', async () => {
    const added: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: (path) => added.push(path),
      onChange: () => {},
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    watcher.addSuppression('suppressed.md')
    mockWatcher.emit('add', 'suppressed.md')
    mockWatcher.emit('add', 'normal.md')

    expect(added).toEqual(['normal.md'])
  })

  it('suppresses change events for suppressed paths', async () => {
    const changed: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: (path) => changed.push(path),
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    watcher.addSuppression('suppressed.md')
    mockWatcher.emit('change', 'suppressed.md')

    expect(changed).toEqual([])
  })

  it('resumes events after suppression is removed', async () => {
    const changed: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: (path) => changed.push(path),
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    watcher.addSuppression('test.md')
    mockWatcher.emit('change', 'test.md')
    expect(changed).toEqual([])

    watcher.removeSuppression('test.md')
    mockWatcher.emit('change', 'test.md')
    expect(changed).toEqual(['test.md'])
  })

  it('handles multiple simultaneous suppressions', async () => {
    const changed: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: (path) => changed.push(path),
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    watcher.addSuppression('a.md')
    watcher.addSuppression('b.md')
    mockWatcher.emit('change', 'a.md')
    mockWatcher.emit('change', 'b.md')
    mockWatcher.emit('change', 'c.md')

    expect(changed).toEqual(['c.md'])
  })

  it('stop() closes watcher and clears suppressions', async () => {
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: () => {},
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    watcher.addSuppression('test.md')
    await watcher.stop()

    expect(mockWatcher.close).toHaveBeenCalled()
  })

  it('handles subdirectory paths', async () => {
    const added: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: (path) => added.push(path),
      onChange: () => {},
      onDelete: () => {},
      onCommentFileChange: () => {},
    })
    await watcher.start()

    mockWatcher.emit('add', 'subdir/nested.md')

    expect(added).toEqual(['subdir/nested.md'])
  })

  it('routes comment sidecar changes to onCommentFileChange', async () => {
    const commentChanges: string[] = []
    const markdownChanges: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: (path) => markdownChanges.push(path),
      onDelete: () => {},
      onCommentFileChange: (path) => commentChanges.push(path),
    })
    await watcher.start()

    mockWatcher.emit('change', '.collabmd/comments/docs/file.md.comments.json')

    expect(commentChanges).toEqual(['.collabmd/comments/docs/file.md.comments.json'])
    expect(markdownChanges).toEqual([])
  })

  it('suppresses comment sidecar events for suppressed paths', async () => {
    const commentChanges: string[] = []
    watcher = new FileWatcher('/tmp/test', {
      onAdd: () => {},
      onChange: () => {},
      onDelete: () => {},
      onCommentFileChange: (path) => commentChanges.push(path),
    })
    await watcher.start()

    const sidecar = '.collabmd/comments/docs/file.md.comments.json'
    watcher.addSuppression(sidecar)
    mockWatcher.emit('change', sidecar)
    mockWatcher.emit('change', sidecar)

    expect(commentChanges).toEqual([sidecar])
  })
})
