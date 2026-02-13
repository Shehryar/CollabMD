import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { CrdtBridge } from './crdt-bridge.js'
import { FileWatcher } from './file-watcher.js'

describe('CrdtBridge', () => {
  let tempDir: string
  let ydoc: Y.Doc
  let ytext: Y.Text
  let awareness: Awareness
  let fileWatcher: FileWatcher
  let bridge: CrdtBridge | null = null
  const filePath = () => join(tempDir, 'test.md')

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'collabmd-bridge-'))
    ydoc = new Y.Doc()
    ytext = ydoc.getText('codemirror')
    awareness = new Awareness(ydoc)
    // Create a minimal file watcher (just tracks suppression, no actual watching needed for unit tests)
    fileWatcher = new FileWatcher(tempDir, {
      onAdd: () => {},
      onChange: () => {},
      onDelete: () => {},
    })
  })

  afterEach(() => {
    if (bridge) {
      bridge.destroy()
      bridge = null
    }
    awareness.destroy()
    ydoc.destroy()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const getCursorIndex = (): number | null => {
    const state = awareness.getLocalState()
    const cursor = state?.cursor as { head?: Y.RelativePosition } | undefined
    if (!cursor?.head) return null
    const absolute = Y.createAbsolutePositionFromRelativePosition(cursor.head, ydoc)
    return absolute?.index ?? null
  }

  describe('initialize', () => {
    it('loads file content into empty CRDT', () => {
      writeFileSync(filePath(), 'Hello from file')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      expect(ytext.toString()).toBe('Hello from file')
    })

    it('writes CRDT content to file when CRDT has content (server wins)', () => {
      writeFileSync(filePath(), 'local content')
      ydoc.transact(() => {
        ytext.insert(0, 'server content')
      })
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      expect(readFileSync(filePath(), 'utf-8')).toBe('server content')
    })

    it('handles empty file and empty CRDT', () => {
      writeFileSync(filePath(), '')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      expect(ytext.toString()).toBe('')
    })

    it('handles non-existent file with CRDT content', () => {
      // File does not exist, CRDT has content -> write file
      ydoc.transact(() => {
        ytext.insert(0, 'only in crdt')
      })
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      expect(readFileSync(filePath(), 'utf-8')).toBe('only in crdt')
    })

    it('does not write file when CRDT content matches file content', () => {
      writeFileSync(filePath(), 'same content')
      ydoc.transact(() => {
        ytext.insert(0, 'same content')
      })
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // Content matches, so file should not be rewritten
      // We verify by checking the CRDT still has the right content
      expect(ytext.toString()).toBe('same content')
      expect(readFileSync(filePath(), 'utf-8')).toBe('same content')
    })

    it('does not modify empty CRDT when file is also empty', () => {
      writeFileSync(filePath(), '')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      expect(ytext.toString()).toBe('')
      expect(readFileSync(filePath(), 'utf-8')).toBe('')
    })
  })

  describe('file -> CRDT (onFileChange)', () => {
    it('applies file changes to CRDT using fast-diff', () => {
      writeFileSync(filePath(), 'Hello World')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()
      expect(ytext.toString()).toBe('Hello World')

      // Simulate file change
      writeFileSync(filePath(), 'Hello Beautiful World')
      bridge.onFileChange()

      expect(ytext.toString()).toBe('Hello Beautiful World')
    })

    it('handles complete content replacement', () => {
      writeFileSync(filePath(), 'original')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      writeFileSync(filePath(), 'completely new')
      bridge.onFileChange()

      expect(ytext.toString()).toBe('completely new')
    })

    it('skips onFileChange when content hash matches (layer 2: content hash)', () => {
      writeFileSync(filePath(), 'unchanged content')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // File content has not changed, onFileChange should be a no-op
      bridge.onFileChange()
      expect(ytext.toString()).toBe('unchanged content')
    })

    it('handles appending to file', () => {
      writeFileSync(filePath(), 'line 1\n')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      writeFileSync(filePath(), 'line 1\nline 2\n')
      bridge.onFileChange()

      expect(ytext.toString()).toBe('line 1\nline 2\n')
    })

    it('handles deletion from file', () => {
      writeFileSync(filePath(), 'abc def ghi')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      writeFileSync(filePath(), 'abc ghi')
      bridge.onFileChange()

      expect(ytext.toString()).toBe('abc ghi')
    })

    it('handles multiple sequential file changes', () => {
      writeFileSync(filePath(), 'version 1')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      writeFileSync(filePath(), 'version 2')
      bridge.onFileChange()
      expect(ytext.toString()).toBe('version 2')

      writeFileSync(filePath(), 'version 3')
      bridge.onFileChange()
      expect(ytext.toString()).toBe('version 3')
    })

    it('sets awareness cursor at end of appended text', () => {
      writeFileSync(filePath(), 'hello')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      writeFileSync(filePath(), 'hello world')
      bridge.onFileChange()

      expect(getCursorIndex()).toBe('hello world'.length)
    })

    it('sets awareness cursor to middle edit location', () => {
      writeFileSync(filePath(), 'Hello world')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      writeFileSync(filePath(), 'Hello brave world')
      bridge.onFileChange()

      expect(getCursorIndex()).toBe('Hello brave '.length)
    })

    it('does not set awareness cursor when file content is unchanged', () => {
      writeFileSync(filePath(), 'no changes')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      awareness.setLocalStateField('cursor', null)
      bridge.onFileChange()

      const cursor = awareness.getLocalState()?.cursor
      expect(cursor).toBeNull()
    })
  })

  describe('CRDT -> file (observer)', () => {
    it('writes to file when remote CRDT changes occur', async () => {
      writeFileSync(filePath(), 'initial')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // Simulate a remote change using a second Y.Doc
      const remoteDoc = new Y.Doc()
      const remoteText = remoteDoc.getText('codemirror')

      // Sync initial state to remote
      Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(ydoc))

      // Make change on remote
      remoteDoc.transact(() => {
        remoteText.delete(0, remoteText.length)
        remoteText.insert(0, 'remote change')
      })

      // Apply remote update to our doc (this triggers observer)
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remoteDoc))

      // Wait for write lock to release
      await new Promise((r) => setTimeout(r, 600))

      expect(readFileSync(filePath(), 'utf-8')).toBe('remote change')
      remoteDoc.destroy()
    })

    it('does NOT write to file when change origin is file-change', () => {
      writeFileSync(filePath(), 'initial')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // This simulates a local file change being applied to CRDT
      ydoc.transact(() => {
        ytext.delete(0, ytext.length)
        ytext.insert(0, 'from file change')
      }, 'file-change')

      // File should NOT be rewritten (the change came from the file)
      expect(readFileSync(filePath(), 'utf-8')).toBe('initial')
    })

    it('does NOT write to file for local transactions', () => {
      writeFileSync(filePath(), 'initial')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // Local transaction (origin is null, transaction.local is true)
      ydoc.transact(() => {
        ytext.delete(0, ytext.length)
        ytext.insert(0, 'local transaction')
      })

      // File should NOT be rewritten (local changes are also from us)
      expect(readFileSync(filePath(), 'utf-8')).toBe('initial')
    })
  })

  describe('feedback loop prevention', () => {
    it('layer 1: writeLock prevents onFileChange during write', async () => {
      writeFileSync(filePath(), 'initial')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // Trigger a remote change that causes a file write
      const remoteDoc = new Y.Doc()
      Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(ydoc))
      remoteDoc.transact(() => {
        const rt = remoteDoc.getText('codemirror')
        rt.delete(0, rt.length)
        rt.insert(0, 'remote')
      })
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remoteDoc))

      // Immediately try onFileChange - should be skipped due to writeLock
      bridge.onFileChange()
      // CRDT should still say 'remote', not whatever onFileChange would have done
      expect(ytext.toString()).toBe('remote')

      await new Promise((r) => setTimeout(r, 600))
      remoteDoc.destroy()
    })

    it('layer 2: content hash prevents redundant CRDT updates', () => {
      writeFileSync(filePath(), 'stable content')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // Calling onFileChange when file has not actually changed should be a no-op
      let updateCount = 0
      ydoc.on('update', () => updateCount++)

      bridge.onFileChange()
      expect(updateCount).toBe(0)
    })

    it('layer 3: suppression does not linger after writes', () => {
      writeFileSync(filePath(), 'initial')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // Trigger a remote change
      const remoteDoc = new Y.Doc()
      Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(ydoc))
      remoteDoc.transact(() => {
        const rt = remoteDoc.getText('codemirror')
        rt.delete(0, rt.length)
        rt.insert(0, 'remote write')
      })

      // Before the remote update, suppression should not exist
      expect((fileWatcher as unknown as { suppressedPaths: Set<string> }).suppressedPaths.has('test.md')).toBe(false)

      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remoteDoc))

      // Suppression is added and removed during the same write flow.
      expect((fileWatcher as unknown as { suppressedPaths: Set<string> }).suppressedPaths.has('test.md')).toBe(false)

      remoteDoc.destroy()
    })
  })

  describe('destroy', () => {
    it('removes observer and stops reacting to changes', () => {
      writeFileSync(filePath(), 'initial')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()
      bridge.destroy()

      // Apply remote change after destroy - should NOT write to file
      const remoteDoc = new Y.Doc()
      Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(ydoc))
      remoteDoc.transact(() => {
        const rt = remoteDoc.getText('codemirror')
        rt.delete(0, rt.length)
        rt.insert(0, 'after destroy')
      })
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remoteDoc))

      expect(readFileSync(filePath(), 'utf-8')).toBe('initial')
      remoteDoc.destroy()
      bridge = null // Already destroyed, prevent double destroy in afterEach
    })

    it('can be called multiple times safely', () => {
      writeFileSync(filePath(), 'initial')
      bridge = new CrdtBridge({
        filePath: filePath(),
        relativePath: 'test.md',
        ydoc,
        awareness,
        fileWatcher,
      })
      bridge.initialize()

      // Should not throw when called multiple times
      bridge.destroy()
      bridge.destroy()
      bridge = null
    })
  })
})
