import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as Y from 'yjs'
import { CommentBridge } from './comment-bridge.js'
import type { FileWatcher } from './file-watcher.js'

type MockWatcher = {
  addSuppression: ReturnType<typeof vi.fn>
  removeSuppression: ReturnType<typeof vi.fn>
}

describe('CommentBridge', () => {
  let tempDir: string
  let ydoc: Y.Doc
  let ytext: Y.Text
  let ycomments: Y.Array<Y.Map<unknown>>
  let watcher: MockWatcher
  let bridge: CommentBridge | null = null

  const documentPath = 'docs/test.md'
  const sidecarRelativePath = '.collabmd/comments/docs/test.md.comments.json'
  const sidecarPath = () => join(tempDir, sidecarRelativePath)

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'collabmd-comment-bridge-'))
    ydoc = new Y.Doc()
    ytext = ydoc.getText('codemirror')
    ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
    watcher = {
      addSuppression: vi.fn(),
      removeSuppression: vi.fn(),
    }
  })

  afterEach(() => {
    bridge?.destroy()
    bridge = null
    ydoc.destroy()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  const initializeBridge = (writeDebounceMs = 200): void => {
    bridge = new CommentBridge({
      ydoc,
      ytext,
      ycomments,
      documentPath,
      sidecarPath: sidecarPath(),
      sidecarRelativePath,
      fileWatcher: watcher as unknown as FileWatcher,
      writeDebounceMs,
    })
    bridge.initialize()
  }

  const lineStart = (line: number): number => {
    const content = ytext.toString()
    const starts = [0]
    for (let i = 0; i < content.length; i += 1) {
      if (content[i] === '\n') starts.push(i + 1)
    }
    const clamped = Math.max(1, Math.min(line, starts.length))
    return starts[clamped - 1] ?? 0
  }

  const addComment = (input: {
    id: string
    startIndex: number
    endIndex: number
    text: string
    resolved?: boolean
    source?: 'browser' | 'daemon'
    authorName?: string
    createdAt?: string
    thread?: Array<{ authorName: string; text: string; createdAt: string }>
    suggestion?: { originalText: string; proposedText: string; status: 'pending' | 'accepted' | 'dismissed' }
  }): void => {
    ydoc.transact(() => {
      const ycomment = new Y.Map<unknown>()
      ycomment.set('id', input.id)
      ycomment.set(
        'anchorStart',
        Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, input.startIndex)),
      )
      ycomment.set(
        'anchorEnd',
        Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, input.endIndex)),
      )
      ycomment.set('authorId', input.authorName ?? 'author')
      ycomment.set('authorName', input.authorName ?? 'author')
      ycomment.set('source', input.source ?? 'browser')
      ycomment.set('text', input.text)
      ycomment.set('createdAt', input.createdAt ?? '2026-02-10T12:00:00Z')
      ycomment.set('resolved', input.resolved ?? false)
      if (input.suggestion) {
        const ysuggestion = new Y.Map<unknown>()
        ysuggestion.set('originalText', input.suggestion.originalText)
        ysuggestion.set('proposedText', input.suggestion.proposedText)
        ysuggestion.set('status', input.suggestion.status)
        ycomment.set('suggestion', ysuggestion)
      }

      const thread = new Y.Array<Y.Map<unknown>>()
      for (const reply of input.thread ?? []) {
        const yreply = new Y.Map<unknown>()
        yreply.set('authorId', reply.authorName)
        yreply.set('authorName', reply.authorName)
        yreply.set('text', reply.text)
        yreply.set('createdAt', reply.createdAt)
        thread.push([yreply])
      }
      ycomment.set('thread', thread)

      ycomments.push([ycomment])
    }, 'test-comment')
  }

  const getAbsoluteIndex = (anchor: Uint8Array): number | null => {
    const rel = Y.decodeRelativePosition(anchor)
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, ydoc)
    if (!abs || abs.type !== ytext) return null
    return abs.index
  }

  const readSidecar = (): {
    documentPath: string
    comments: Array<{
      id: string
      line: number
      endLine: number
      author: string
      source: 'browser' | 'daemon'
      text: string
      createdAt: string
      resolved: boolean
      thread: Array<{ author: string; text: string; createdAt: string }>
      suggestion?: { originalText: string; proposedText: string; status: 'pending' | 'accepted' | 'dismissed' }
    }>
  } => JSON.parse(readFileSync(sidecarPath(), 'utf-8')) as {
    documentPath: string
    comments: Array<{
      id: string
      line: number
      endLine: number
      author: string
      source: 'browser' | 'daemon'
      text: string
      createdAt: string
      resolved: boolean
      thread: Array<{ author: string; text: string; createdAt: string }>
      suggestion?: { originalText: string; proposedText: string; status: 'pending' | 'accepted' | 'dismissed' }
    }>
  }

  it('writes CRDT comments to sidecar with line numbers', () => {
    ytext.insert(0, 'line 1\nline 2\nline 3\n')
    addComment({
      id: 'c-1',
      startIndex: lineStart(2),
      endIndex: lineStart(3),
      text: 'Needs detail',
      authorName: 'PM',
      source: 'browser',
      thread: [{ authorName: 'Claude', text: 'Will update', createdAt: '2026-02-10T12:05:00Z' }],
    })

    initializeBridge()

    const sidecar = readSidecar()
    expect(sidecar.documentPath).toBe(documentPath)
    expect(sidecar.comments).toEqual([
      {
        id: 'c-1',
        line: 2,
        endLine: 3,
        author: 'PM',
        source: 'browser',
        text: 'Needs detail',
        createdAt: '2026-02-10T12:00:00Z',
        resolved: false,
        thread: [{ author: 'Claude', text: 'Will update', createdAt: '2026-02-10T12:05:00Z' }],
      },
    ])
  })

  it('serializes suggestion data to sidecar JSON', () => {
    ytext.insert(0, 'hello world')
    addComment({
      id: 'suggest-1',
      startIndex: 6,
      endIndex: 11,
      text: 'Suggested edit',
      authorName: 'Agent',
      source: 'daemon',
      suggestion: {
        originalText: 'world',
        proposedText: 'team',
        status: 'pending',
      },
    })

    initializeBridge()

    const sidecar = readSidecar()
    expect(sidecar.comments[0]?.suggestion).toEqual({
      originalText: 'world',
      proposedText: 'team',
      status: 'pending',
    })
  })

  it('reads sidecar comments into CRDT and clamps out-of-range lines', () => {
    ytext.insert(0, 'a\nb\nc')
    initializeBridge()

    mkdirSync(join(tempDir, '.collabmd', 'comments', 'docs'), { recursive: true })
    writeFileSync(
      sidecarPath(),
      JSON.stringify(
        {
          documentPath,
          comments: [
            {
              id: 'from-file',
              line: 2,
              endLine: 99,
              author: 'Agent',
              source: 'daemon',
              text: 'Investigate this section',
              createdAt: '2026-02-11T10:00:00Z',
              resolved: false,
              thread: [],
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    bridge!.onCommentFileChange()

    expect(ycomments.length).toBe(1)
    const created = ycomments.get(0)
    expect(created.get('id')).toBe('from-file')
    expect(created.get('authorName')).toBe('Agent')
    expect(created.get('source')).toBe('daemon')

    const startIndex = getAbsoluteIndex(created.get('anchorStart') as Uint8Array)
    const endIndex = getAbsoluteIndex(created.get('anchorEnd') as Uint8Array)
    expect(startIndex).toBe(lineStart(2))
    expect(endIndex).toBe(lineStart(3))
  })

  it('deserializes suggestion data from sidecar JSON', () => {
    ytext.insert(0, 'hello world')
    initializeBridge()

    mkdirSync(join(tempDir, '.collabmd', 'comments', 'docs'), { recursive: true })
    writeFileSync(
      sidecarPath(),
      JSON.stringify(
        {
          documentPath,
          comments: [
            {
              id: 'suggest-from-file',
              line: 1,
              endLine: 1,
              author: 'Agent',
              source: 'daemon',
              text: 'Suggested edit',
              createdAt: '2026-02-11T10:00:00Z',
              resolved: false,
              thread: [],
              suggestion: {
                originalText: 'hello',
                proposedText: 'hi',
                status: 'pending',
              },
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )

    bridge!.onCommentFileChange()

    const created = ycomments.get(0)
    const suggestion = created.get('suggestion') as Y.Map<unknown>
    expect(suggestion.get('originalText')).toBe('hello')
    expect(suggestion.get('proposedText')).toBe('hi')
    expect(suggestion.get('status')).toBe('pending')
  })

  it('round-trips comment updates from CRDT to sidecar and back', () => {
    ytext.insert(0, 'first\nsecond\nthird')
    addComment({
      id: 'roundtrip-1',
      startIndex: lineStart(1),
      endIndex: lineStart(2),
      text: 'Initial note',
      authorName: 'PM',
      source: 'browser',
    })
    initializeBridge()

    const current = readSidecar()
    current.comments[0]!.resolved = true
    current.comments[0]!.thread.push({
      author: 'Claude',
      text: 'Done in next patch',
      createdAt: '2026-02-11T10:05:00Z',
    })
    writeFileSync(sidecarPath(), JSON.stringify(current, null, 2) + '\n', 'utf-8')

    bridge!.onCommentFileChange()

    const updated = ycomments.get(0)
    expect(updated.get('resolved')).toBe(true)
    const thread = updated.get('thread') as Y.Array<Y.Map<unknown>>
    expect(thread.length).toBe(1)
    expect(thread.get(0).get('text')).toBe('Done in next patch')
  })

  it('converts first and last lines correctly', () => {
    ytext.insert(0, 'one\ntwo\nthree')
    addComment({
      id: 'edges-1',
      startIndex: lineStart(1),
      endIndex: ytext.length,
      text: 'top to bottom',
      authorName: 'QA',
    })
    initializeBridge()

    const sidecar = readSidecar()
    expect(sidecar.comments[0]?.line).toBe(1)
    expect(sidecar.comments[0]?.endLine).toBe(3)
  })

  it('defaults line numbers to 1 when document text is empty', () => {
    addComment({
      id: 'empty-1',
      startIndex: 0,
      endIndex: 0,
      text: 'empty doc note',
      authorName: 'QA',
    })
    initializeBridge()

    const sidecar = readSidecar()
    expect(sidecar.comments[0]?.line).toBe(1)
    expect(sidecar.comments[0]?.endLine).toBe(1)
  })

  it('syncs thread replies both directions', () => {
    ytext.insert(0, 'x\ny\nz')
    addComment({
      id: 'thread-1',
      startIndex: lineStart(2),
      endIndex: lineStart(2),
      text: 'Thread root',
      authorName: 'PM',
      thread: [{ authorName: 'Claude', text: 'Initial reply', createdAt: '2026-02-11T10:00:00Z' }],
    })

    initializeBridge()

    const sidecar = readSidecar()
    expect(sidecar.comments[0]?.thread).toEqual([
      { author: 'Claude', text: 'Initial reply', createdAt: '2026-02-11T10:00:00Z' },
    ])

    sidecar.comments[0]!.thread.push({
      author: 'PM',
      text: 'Follow-up',
      createdAt: '2026-02-11T10:01:00Z',
    })
    writeFileSync(sidecarPath(), JSON.stringify(sidecar, null, 2) + '\n', 'utf-8')

    bridge!.onCommentFileChange()

    const thread = (ycomments.get(0).get('thread') as Y.Array<Y.Map<unknown>>).toArray()
    expect(thread.length).toBe(2)
    expect(thread[1]?.get('text')).toBe('Follow-up')
  })

  it('syncs resolved status both directions', async () => {
    ytext.insert(0, 'a\nb')
    addComment({
      id: 'resolved-1',
      startIndex: lineStart(1),
      endIndex: lineStart(2),
      text: 'Resolve me',
      authorName: 'PM',
      resolved: false,
    })

    initializeBridge(60)
    watcher.addSuppression.mockClear()
    watcher.removeSuppression.mockClear()

    ydoc.transact(() => {
      ycomments.get(0).set('resolved', true)
    }, 'remote-change')
    await wait(90)

    const sidecar = readSidecar()
    expect(sidecar.comments[0]?.resolved).toBe(true)

    sidecar.comments[0]!.resolved = false
    writeFileSync(sidecarPath(), JSON.stringify(sidecar, null, 2) + '\n', 'utf-8')
    bridge!.onCommentFileChange()

    expect(ycomments.get(0).get('resolved')).toBe(false)
  })

  it('applies sidecar suggestion status changes to CRDT', () => {
    ytext.insert(0, 'hello world')
    addComment({
      id: 'status-sync-1',
      startIndex: 6,
      endIndex: 11,
      text: 'Suggested edit',
      authorName: 'Agent',
      resolved: false,
      suggestion: {
        originalText: 'world',
        proposedText: 'team',
        status: 'pending',
      },
    })
    initializeBridge()

    const sidecar = readSidecar()
    sidecar.comments[0]!.suggestion = {
      originalText: 'world',
      proposedText: 'team',
      status: 'accepted',
    }
    writeFileSync(sidecarPath(), JSON.stringify(sidecar, null, 2) + '\n', 'utf-8')
    bridge!.onCommentFileChange()

    expect(ytext.toString()).toBe('hello team')
    const suggestion = ycomments.get(0).get('suggestion') as Y.Map<unknown>
    expect(suggestion.get('status')).toBe('accepted')
    expect(ycomments.get(0).get('resolved')).toBe(true)
  })

  it('marks CRDT comments as resolved when removed from sidecar', () => {
    ytext.insert(0, 'alpha\nbeta')
    addComment({
      id: 'remove-1',
      startIndex: lineStart(1),
      endIndex: lineStart(2),
      text: 'remove me from sidecar',
      authorName: 'PM',
      resolved: false,
    })
    initializeBridge()

    writeFileSync(
      sidecarPath(),
      JSON.stringify({ documentPath, comments: [] }, null, 2) + '\n',
      'utf-8',
    )
    bridge!.onCommentFileChange()

    expect(ycomments.get(0).get('resolved')).toBe(true)
  })

  it('avoids feedback loops when reading its own sidecar write', () => {
    ytext.insert(0, 'hello')
    addComment({
      id: 'loop-1',
      startIndex: 0,
      endIndex: ytext.length,
      text: 'No loop',
    })
    initializeBridge()

    let updates = 0
    ydoc.on('update', () => {
      updates += 1
    })

    bridge!.onCommentFileChange()

    expect(updates).toBe(0)
  })

  it('debounces rapid CRDT comment updates into one sidecar write', async () => {
    ytext.insert(0, 'one\ntwo\nthree')
    initializeBridge(80)
    watcher.addSuppression.mockClear()
    watcher.removeSuppression.mockClear()

    addComment({ id: 'd1', startIndex: lineStart(1), endIndex: lineStart(1), text: 'a' })
    addComment({ id: 'd2', startIndex: lineStart(2), endIndex: lineStart(2), text: 'b' })
    addComment({ id: 'd3', startIndex: lineStart(3), endIndex: lineStart(3), text: 'c' })

    await wait(30)
    expect(watcher.addSuppression).not.toHaveBeenCalled()

    await wait(120)
    expect(watcher.addSuppression).toHaveBeenCalledTimes(1)
    expect(watcher.removeSuppression).toHaveBeenCalledTimes(1)
    expect(readSidecar().comments).toHaveLength(3)
  })

  it('skips malformed sidecar JSON and keeps running', () => {
    initializeBridge()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mkdirSync(join(tempDir, '.collabmd', 'comments', 'docs'), { recursive: true })
    writeFileSync(sidecarPath(), '{invalid json', 'utf-8')
    bridge!.onCommentFileChange()

    expect(ycomments.length).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
  })
})
