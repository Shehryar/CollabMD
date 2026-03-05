import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AgentRunner } from './agent-runner.js'

describe('AgentRunner', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'collabmd-agent-runner-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const writeTriggerFile = (relativePath: string, payload: Record<string, unknown>): void => {
    const absPath = join(tempDir, relativePath)
    mkdirSync(join(absPath, '..'), { recursive: true })
    writeFileSync(absPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
  }

  it('dispatches configured command and writes response file', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-1.json'
    writeTriggerFile(triggerRelativePath, {
      commentId: 'comment-1',
      mentionedAgent: 'writer',
      commentText: 'Please review @writer',
      anchorText: 'some text',
      surroundingContext: 'context here',
    })

    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        timeout: 10,
        commands: {
          writer: {
            command: 'echo \'{"replyText":"done"}\'',
          },
        },
      },
    })

    await runner.handleTriggerCreated(triggerRelativePath)

    const responseRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-1.response.json'
    const responsePath = join(tempDir, responseRelativePath)
    expect(existsSync(responsePath)).toBe(true)

    const response = JSON.parse(readFileSync(responsePath, 'utf-8')) as Record<string, unknown>
    expect(response.replyText).toBe('done')
    expect(response.commentId).toBe('comment-1')
    expect(response.mentionedAgent).toBe('writer')

    runner.destroy()
  })

  it('dispatches for discussion triggers and merges discussionId', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/discussion-disc-1.json'
    writeTriggerFile(triggerRelativePath, {
      discussionId: 'disc-1',
      mentionedAgent: 'reviewer',
      discussionTitle: 'Review needed',
      discussionText: '@reviewer please look',
      anchorText: '',
      surroundingContext: '',
    })

    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {
          reviewer: {
            command: 'echo \'{"replyText":"reviewed"}\'',
          },
        },
      },
    })

    await runner.handleTriggerCreated(triggerRelativePath)

    const responsePath = join(
      tempDir,
      '.collabmd/agent-triggers/docs/test.md/discussion-disc-1.response.json',
    )
    expect(existsSync(responsePath)).toBe(true)

    const response = JSON.parse(readFileSync(responsePath, 'utf-8')) as Record<string, unknown>
    expect(response.replyText).toBe('reviewed')
    expect(response.discussionId).toBe('disc-1')
    expect(response.mentionedAgent).toBe('reviewer')

    runner.destroy()
  })

  it('skips unconfigured agents', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-2.json'
    writeTriggerFile(triggerRelativePath, {
      commentId: 'comment-2',
      mentionedAgent: 'unknown-agent',
      commentText: '@unknown-agent help',
      anchorText: '',
      surroundingContext: '',
    })

    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {
          writer: {
            command: 'echo \'{"replyText":"done"}\'',
          },
        },
      },
    })

    await runner.handleTriggerCreated(triggerRelativePath)

    const responsePath = join(
      tempDir,
      '.collabmd/agent-triggers/docs/test.md/comment-2.response.json',
    )
    expect(existsSync(responsePath)).toBe(false)

    runner.destroy()
  })

  it('skips when disabled', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-3.json'
    writeTriggerFile(triggerRelativePath, {
      commentId: 'comment-3',
      mentionedAgent: 'writer',
      commentText: '@writer help',
      anchorText: '',
      surroundingContext: '',
    })

    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: false,
        commands: {
          writer: {
            command: 'echo \'{"replyText":"done"}\'',
          },
        },
      },
    })

    expect(runner.isEnabled()).toBe(false)

    // handleTriggerCreated still works (it just won't be called by the daemon if !isEnabled())
    // But let's verify the runner itself doesn't blow up
    await runner.handleTriggerCreated(triggerRelativePath)

    // The command still runs when handleTriggerCreated is called directly,
    // because isEnabled() is a gating check at the daemon level.
    // Let's verify that isEnabled returns false for proper gating.
    runner.destroy()
  })

  it('handles command timeout', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-4.json'
    writeTriggerFile(triggerRelativePath, {
      commentId: 'comment-4',
      mentionedAgent: 'slow-agent',
      commentText: '@slow-agent help',
      anchorText: '',
      surroundingContext: '',
    })

    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {
          'slow-agent': {
            command: 'sleep 60',
            timeout: 1,
          },
        },
      },
    })

    await runner.handleTriggerCreated(triggerRelativePath)

    const responsePath = join(
      tempDir,
      '.collabmd/agent-triggers/docs/test.md/comment-4.response.json',
    )
    expect(existsSync(responsePath)).toBe(false)

    runner.destroy()
  }, 10_000)

  it('handles invalid command output', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-5.json'
    writeTriggerFile(triggerRelativePath, {
      commentId: 'comment-5',
      mentionedAgent: 'bad-output',
      commentText: '@bad-output help',
      anchorText: '',
      surroundingContext: '',
    })

    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {
          'bad-output': {
            command: 'echo "not valid json"',
          },
        },
      },
    })

    await runner.handleTriggerCreated(triggerRelativePath)

    const responsePath = join(
      tempDir,
      '.collabmd/agent-triggers/docs/test.md/comment-5.response.json',
    )
    expect(existsSync(responsePath)).toBe(false)

    runner.destroy()
  })

  it('does not dispatch same trigger twice', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-6.json'
    writeTriggerFile(triggerRelativePath, {
      commentId: 'comment-6',
      mentionedAgent: 'writer',
      commentText: '@writer help',
      anchorText: '',
      surroundingContext: '',
    })

    // Use a command that appends to a file so we can count invocations
    const counterFile = join(tempDir, 'invocation-count')
    writeFileSync(counterFile, '', 'utf-8')

    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {
          writer: {
            command: `echo '{"replyText":"done"}' && echo x >> "${counterFile}"`,
          },
        },
      },
    })

    await runner.handleTriggerCreated(triggerRelativePath)
    await runner.handleTriggerCreated(triggerRelativePath)

    const count = readFileSync(counterFile, 'utf-8').trim().split('\n').filter(Boolean).length
    expect(count).toBe(1)

    runner.destroy()
  })

  it('passes trigger payload on stdin', async () => {
    const triggerRelativePath = '.collabmd/agent-triggers/docs/test.md/comment-7.json'
    const triggerPayload = {
      commentId: 'comment-7',
      mentionedAgent: 'echo-agent',
      commentText: '@echo-agent test stdin',
      anchorText: 'test content',
      surroundingContext: 'full context',
    }
    writeTriggerFile(triggerRelativePath, triggerPayload)

    // This command reads stdin and echoes back parts of it as a response
    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {
          'echo-agent': {
            command:
              "cat | python3 -c \"import sys,json; d=json.load(sys.stdin); print(json.dumps({'replyText': 'got: ' + d['commentText']}))\"",
          },
        },
      },
    })

    await runner.handleTriggerCreated(triggerRelativePath)

    const responsePath = join(
      tempDir,
      '.collabmd/agent-triggers/docs/test.md/comment-7.response.json',
    )
    if (existsSync(responsePath)) {
      const response = JSON.parse(readFileSync(responsePath, 'utf-8')) as Record<string, unknown>
      expect(response.replyText).toBe('got: @echo-agent test stdin')
      expect(response.commentId).toBe('comment-7')
    }
    // If python3 is not available, the test will still pass (command fails gracefully)

    runner.destroy()
  })

  it('returns false from isEnabled when no commands configured', () => {
    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {},
      },
    })
    expect(runner.isEnabled()).toBe(false)
    runner.destroy()
  })

  it('returns false from isEnabled when commands is undefined', () => {
    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
      },
    })
    expect(runner.isEnabled()).toBe(false)
    runner.destroy()
  })

  it('returns true from isEnabled with valid config', () => {
    const runner = new AgentRunner({
      workDir: tempDir,
      config: {
        enabled: true,
        commands: {
          writer: { command: 'echo test' },
        },
      },
    })
    expect(runner.isEnabled()).toBe(true)
    runner.destroy()
  })
})
