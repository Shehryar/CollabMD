import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as Y from 'yjs'
import { DiscussionBridge } from './discussion-bridge.js'
import type { FileWatcher } from './file-watcher.js'

describe('DiscussionBridge', () => {
  let tempDir: string
  let ydoc: Y.Doc
  let ydiscussions: Y.Array<Y.Map<unknown>>
  let bridge: DiscussionBridge | null = null

  const watcher = {
    addSuppression: vi.fn(),
    removeSuppression: vi.fn(),
  }

  const sidecarRelativePath = '.collabmd/discussions/docs/file.md.discussions.json'
  const sidecarPath = () => join(tempDir, sidecarRelativePath)

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'collabmd-discussion-bridge-'))
    ydoc = new Y.Doc()
    ydiscussions = ydoc.getArray<Y.Map<unknown>>('discussions')
    vi.clearAllMocks()
  })

  afterEach(() => {
    bridge?.destroy()
    bridge = null
    ydoc.destroy()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function initialize() {
    bridge = new DiscussionBridge({
      ydoc,
      ydiscussions,
      workDir: tempDir,
      documentPath: 'docs/file.md',
      sidecarPath: sidecarPath(),
      sidecarRelativePath,
      fileWatcher: watcher as unknown as FileWatcher,
    })
    bridge.initialize()
  }

  it('writes CRDT discussions to sidecar', () => {
    const discussion = new Y.Map<unknown>()
    const author = new Y.Map<unknown>()
    author.set('userId', 'u-1')
    author.set('name', 'User')
    discussion.set('id', 'd-1')
    discussion.set('author', author)
    discussion.set('title', 'Thread')
    discussion.set('text', 'Body')
    discussion.set('createdAt', '2026-02-12T00:00:00.000Z')
    discussion.set('resolved', false)
    discussion.set('thread', new Y.Array<Y.Map<unknown>>())
    ydiscussions.push([discussion])

    initialize()

    const payload = JSON.parse(readFileSync(sidecarPath(), 'utf-8')) as { discussions: Array<{ id: string; title: string }> }
    expect(payload.discussions).toHaveLength(1)
    expect(payload.discussions[0]?.id).toBe('d-1')
    expect(payload.discussions[0]?.title).toBe('Thread')
  })

  it('reads sidecar discussions into CRDT', () => {
    initialize()
    mkdirSync(join(tempDir, '.collabmd', 'discussions', 'docs'), { recursive: true })
    writeFileSync(sidecarPath(), JSON.stringify({
      documentPath: 'docs/file.md',
      discussions: [
        {
          id: 'd-2',
          author: { userId: 'u-2', name: 'Agent' },
          title: 'Incoming',
          text: 'From sidecar',
          createdAt: '2026-02-12T00:00:00.000Z',
          resolved: false,
          thread: [],
        },
      ],
    }, null, 2) + '\n', 'utf-8')

    bridge!.onDiscussionFileChange()

    expect(ydiscussions.length).toBe(1)
    expect(ydiscussions.get(0).get('id')).toBe('d-2')
    expect(ydiscussions.get(0).get('title')).toBe('Incoming')
  })

  it('writes agent trigger files for discussion mentions', () => {
    const discussion = new Y.Map<unknown>()
    const author = new Y.Map<unknown>()
    author.set('userId', 'u-1')
    author.set('name', 'User')
    discussion.set('id', 'd-mention')
    discussion.set('author', author)
    discussion.set('title', 'Thread')
    discussion.set('text', 'Can you review this @writer?')
    discussion.set('createdAt', '2026-02-12T00:00:00.000Z')
    discussion.set('resolved', false)
    discussion.set('thread', new Y.Array<Y.Map<unknown>>())
    ydiscussions.push([discussion])

    initialize()

    const triggerPath = join(tempDir, '.collabmd', 'agent-triggers', 'docs', 'file.md', 'discussion-d-mention.json')
    const trigger = JSON.parse(readFileSync(triggerPath, 'utf-8')) as {
      discussionId: string
      mentionedAgent: string
      discussionText: string
    }
    expect(trigger.discussionId).toBe('d-mention')
    expect(trigger.mentionedAgent).toBe('writer')
    expect(trigger.discussionText).toContain('@writer')
  })

  it('applies agent response file as discussion thread reply', () => {
    const discussion = new Y.Map<unknown>()
    const author = new Y.Map<unknown>()
    author.set('userId', 'u-1')
    author.set('name', 'User')
    discussion.set('id', 'd-reply')
    discussion.set('author', author)
    discussion.set('title', 'Thread')
    discussion.set('text', 'Start')
    discussion.set('createdAt', '2026-02-12T00:00:00.000Z')
    discussion.set('resolved', false)
    discussion.set('thread', new Y.Array<Y.Map<unknown>>())
    ydiscussions.push([discussion])

    initialize()

    const responseRelativePath = '.collabmd/agent-triggers/docs/file.md/discussion-d-reply.response.json'
    const responsePath = join(tempDir, responseRelativePath)
    mkdirSync(join(tempDir, '.collabmd', 'agent-triggers', 'docs', 'file.md'), { recursive: true })
    writeFileSync(responsePath, JSON.stringify({
      discussionId: 'd-reply',
      mentionedAgent: 'writer',
      replyText: 'Looks good to me.',
      resolved: true,
    }, null, 2) + '\n', 'utf-8')

    bridge!.onAgentTriggerResponseFileChange(responseRelativePath)

    const updated = ydiscussions.get(0)
    const thread = updated.get('thread') as Y.Array<Y.Map<unknown>>
    expect(thread.length).toBe(1)
    expect(thread.get(0).get('text')).toBe('Looks good to me.')
    expect(updated.get('resolved')).toBe(true)
  })
})
