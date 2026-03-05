import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { FolderDaemon } from './folder-daemon.js'
import { CommentBridge } from './comment-bridge.js'
import type { FileWatcher } from './file-watcher.js'

type MockWatcher = {
  addSuppression: ReturnType<typeof vi.fn>
  removeSuppression: ReturnType<typeof vi.fn>
}

describe('FolderDaemon agent trigger flow', () => {
  let tempDir: string
  let ydoc: Y.Doc
  let ytext: Y.Text
  let ycomments: Y.Array<Y.Map<unknown>>
  let awareness: Awareness
  let watcher: MockWatcher
  let commentBridge: CommentBridge

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'collabmd-folder-daemon-agent-flow-'))
    ydoc = new Y.Doc()
    ytext = ydoc.getText('codemirror')
    ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
    awareness = new Awareness(ydoc)
    watcher = {
      addSuppression: vi.fn(),
      removeSuppression: vi.fn(),
    }

    ytext.insert(0, 'alpha\nbeta\ngamma')
    commentBridge = new CommentBridge({
      ydoc,
      ytext,
      ycomments,
      workDir: tempDir,
      documentPath: 'docs/test.md',
      sidecarPath: join(tempDir, '.collabmd/comments/docs/test.md.comments.json'),
      sidecarRelativePath: '.collabmd/comments/docs/test.md.comments.json',
      fileWatcher: watcher as unknown as FileWatcher,
      writeDebounceMs: 10,
    })
    commentBridge.initialize()
  })

  afterEach(() => {
    commentBridge.destroy()
    awareness.destroy()
    ydoc.destroy()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('routes agent response files back into comment threads', () => {
    ydoc.transact(() => {
      const comment = new Y.Map<unknown>()
      comment.set('id', 'comment-1')
      comment.set(
        'anchorStart',
        Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, 6)),
      )
      comment.set(
        'anchorEnd',
        Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, 10)),
      )
      comment.set('authorId', 'user-1')
      comment.set('authorName', 'User')
      comment.set('source', 'browser')
      comment.set('text', 'Please review @writer')
      comment.set('createdAt', '2026-02-17T00:00:00.000Z')
      comment.set('resolved', false)
      comment.set('thread', new Y.Array<Y.Map<unknown>>())
      ycomments.push([comment])
    }, 'test-comment')

    const triggerPath = join(tempDir, '.collabmd/agent-triggers/docs/test.md/comment-1.json')
    const triggerPayload = JSON.parse(readFileSync(triggerPath, 'utf-8')) as {
      commentId: string
      mentionedAgent: string
    }
    expect(triggerPayload).toMatchObject({
      commentId: 'comment-1',
      mentionedAgent: 'writer',
    })

    const daemon = new FolderDaemon({ workDir: tempDir })
    const docs = (daemon as unknown as { docs: Map<string, unknown> }).docs
    docs.set('docs/test.md', {
      ydoc,
      awareness,
      bridge: { onFileChange: vi.fn(), destroy: vi.fn() },
      commentBridge,
      discussionBridge: {
        onDiscussionFileChange: vi.fn(),
        onAgentTriggerResponseFileChange: vi.fn(),
        destroy: vi.fn(),
      },
      syncClient: { disconnect: vi.fn() },
    })

    const responseRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-1.response.json'
    const responsePath = join(tempDir, responseRelativePath)
    mkdirSync(join(tempDir, '.collabmd/agent-triggers/docs/test.md'), { recursive: true })
    writeFileSync(
      responsePath,
      JSON.stringify(
        {
          commentId: 'comment-1',
          mentionedAgent: 'writer',
          replyText: 'Updated section looks good.',
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    ;(
      daemon as unknown as { handleAgentTriggerResponseFileChange: (path: string) => void }
    ).handleAgentTriggerResponseFileChange(responseRelativePath)

    const comment = ycomments.get(0)
    const thread = comment.get('thread') as Y.Array<Y.Map<unknown>>
    expect(thread.length).toBe(1)
    expect(thread.get(0).get('text')).toBe('Updated section looks good.')
  })
})
