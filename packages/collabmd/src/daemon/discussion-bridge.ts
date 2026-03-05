import { createHash } from 'crypto'
import { basename, dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as Y from 'yjs'
import type { FileWatcher } from './file-watcher.js'

const DISCUSSION_BRIDGE_ORIGIN = 'discussion-bridge'
const DEFAULT_WRITE_DEBOUNCE_MS = 200

interface SidecarAuthor {
  userId: string
  name: string
}

interface SidecarReply {
  author: SidecarAuthor
  text: string
  createdAt: string
}

interface SidecarDiscussion {
  id: string
  author: SidecarAuthor
  title: string
  text: string
  createdAt: string
  resolved: boolean
  thread: SidecarReply[]
}

interface SidecarPayload {
  documentPath: string
  discussions: SidecarDiscussion[]
}

interface AgentTriggerPayload {
  discussionId: string
  mentionedAgent: string
  discussionTitle: string
  discussionText: string
  anchorText: string
  surroundingContext: string
}

export class DiscussionBridge {
  private ydoc: Y.Doc
  private ydiscussions: Y.Array<Y.Map<unknown>>
  private workDir: string
  private documentPath: string
  private sidecarPath: string
  private sidecarRelativePath: string
  private fileWatcher: FileWatcher
  private writeDebounceMs: number
  private writeTimer: NodeJS.Timeout | null = null
  private observer:
    | ((events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void)
    | null = null
  private lastSidecarHash = ''
  private processedMentions = new Set<string>()
  private responseHashes = new Map<string, string>()
  private onTriggerCreated?: (triggerRelativePath: string) => void

  constructor(options: {
    ydoc: Y.Doc
    ydiscussions: Y.Array<Y.Map<unknown>>
    workDir: string
    documentPath: string
    sidecarPath: string
    sidecarRelativePath: string
    fileWatcher: FileWatcher
    writeDebounceMs?: number
    onTriggerCreated?: (triggerRelativePath: string) => void
  }) {
    this.ydoc = options.ydoc
    this.ydiscussions = options.ydiscussions
    this.workDir = options.workDir
    this.documentPath = options.documentPath
    this.sidecarPath = options.sidecarPath
    this.sidecarRelativePath = options.sidecarRelativePath
    this.fileWatcher = options.fileWatcher
    this.writeDebounceMs = options.writeDebounceMs ?? DEFAULT_WRITE_DEBOUNCE_MS
    this.onTriggerCreated = options.onTriggerCreated
  }

  initialize(): void {
    this.readFromSidecar()
    this.syncMentionsToTriggerFiles()
    if (existsSync(this.sidecarPath) || this.hasSerializableDiscussions()) {
      this.writeToSidecar()
    }
    this.setupObserver()
  }

  onDiscussionFileChange(): void {
    this.readFromSidecar()
  }

  onAgentTriggerResponseFileChange(responseRelativePath: string): void {
    const responsePath = join(this.workDir, responseRelativePath)
    if (!existsSync(responsePath)) return

    let raw = ''
    try {
      raw = readFileSync(responsePath, 'utf-8')
    } catch {
      return
    }

    const nextHash = this.hash(raw)
    const prevHash = this.responseHashes.get(responseRelativePath)
    if (prevHash === nextHash) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const payload = parsed as {
      discussionId?: unknown
      replyText?: unknown
      text?: unknown
      author?: unknown
      mentionedAgent?: unknown
      resolved?: unknown
    }

    const discussionId =
      this.asString(payload.discussionId).trim() ||
      basename(responseRelativePath, '.response.json').replace(/^discussion-/, '')
    const text = this.asString(payload.replyText).trim() || this.asString(payload.text).trim()
    if (!discussionId || !text) return
    const author =
      this.asString(payload.author).trim() ||
      this.asString(payload.mentionedAgent).trim() ||
      'Agent'
    const shouldResolve = payload.resolved === true
    const createdAt = new Date().toISOString()

    const discussion = this.getDiscussionMapById().get(discussionId)
    if (!discussion) return

    this.ydoc.transact(() => {
      const threadValue = discussion.get('thread')
      const thread =
        threadValue instanceof Y.Array
          ? (threadValue as Y.Array<Y.Map<unknown>>)
          : new Y.Array<Y.Map<unknown>>()
      if (!(threadValue instanceof Y.Array)) discussion.set('thread', thread)

      const reply = new Y.Map<unknown>()
      const authorMap = new Y.Map<unknown>()
      authorMap.set('userId', author)
      authorMap.set('name', author)
      reply.set('author', authorMap)
      reply.set('text', text)
      reply.set('createdAt', createdAt)
      thread.push([reply])
      if (shouldResolve) discussion.set('resolved', true)
    }, DISCUSSION_BRIDGE_ORIGIN)

    this.responseHashes.set(responseRelativePath, nextHash)
  }

  destroy(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    if (this.observer) {
      this.ydiscussions.unobserveDeep(this.observer)
      this.observer = null
    }
  }

  private setupObserver(): void {
    this.observer = (_events, transaction) => {
      if (transaction.origin === DISCUSSION_BRIDGE_ORIGIN) return
      this.syncMentionsToTriggerFiles()
      this.scheduleWrite()
    }
    this.ydiscussions.observeDeep(this.observer)
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.writeToSidecar()
    }, this.writeDebounceMs)
  }

  private writeToSidecar(): void {
    const payload = this.serializeFromCrdt()
    const serialized = JSON.stringify(payload, null, 2) + '\n'
    const nextHash = this.hash(serialized)
    if (nextHash === this.lastSidecarHash && existsSync(this.sidecarPath)) return

    mkdirSync(dirname(this.sidecarPath), { recursive: true })
    this.fileWatcher.addSuppression(this.sidecarRelativePath)
    try {
      writeFileSync(this.sidecarPath, serialized, 'utf-8')
      this.lastSidecarHash = nextHash
    } finally {
      this.fileWatcher.removeSuppression(this.sidecarRelativePath)
    }
  }

  private readFromSidecar(): void {
    if (!existsSync(this.sidecarPath)) return
    let raw = ''
    try {
      raw = readFileSync(this.sidecarPath, 'utf-8')
    } catch {
      return
    }

    const nextHash = this.hash(raw)
    if (nextHash === this.lastSidecarHash) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn(`[DiscussionBridge] Invalid JSON in ${this.sidecarRelativePath}; skipping.`)
      return
    }
    if (!parsed || typeof parsed !== 'object') {
      console.warn(
        `[DiscussionBridge] Invalid sidecar payload in ${this.sidecarRelativePath}; skipping.`,
      )
      return
    }
    const payload = parsed as { discussions?: unknown }
    if (!Array.isArray(payload.discussions)) {
      console.warn(
        `[DiscussionBridge] Missing discussions array in ${this.sidecarRelativePath}; skipping.`,
      )
      return
    }

    this.applySidecarDiff(payload.discussions)
    this.lastSidecarHash = nextHash
  }

  private applySidecarDiff(raw: unknown[]): void {
    const incoming = raw
      .map((value) => this.parseDiscussion(value))
      .filter((value): value is SidecarDiscussion => value !== null)

    const existing = new Map<string, Y.Map<unknown>>()
    for (const value of this.ydiscussions.toArray()) {
      if (!(value instanceof Y.Map)) continue
      const id = this.asString(value.get('id')).trim()
      if (!id) continue
      existing.set(id, value)
    }

    const incomingIds = new Set<string>(incoming.map((entry) => entry.id))

    this.ydoc.transact(() => {
      for (const discussion of incoming) {
        const current = existing.get(discussion.id)
        if (!current) {
          this.ydiscussions.push([this.createYDiscussion(discussion)])
          continue
        }

        current.set('author', this.createYAuthor(discussion.author))
        current.set('title', discussion.title)
        current.set('text', discussion.text)
        current.set('createdAt', discussion.createdAt)
        current.set('resolved', discussion.resolved)
        this.syncThread(current, discussion.thread)
      }

      for (const [id, current] of existing) {
        if (incomingIds.has(id)) continue
        if (current.get('resolved') === true) continue
        current.set('resolved', true)
      }
    }, DISCUSSION_BRIDGE_ORIGIN)
  }

  private createYDiscussion(discussion: SidecarDiscussion): Y.Map<unknown> {
    const ydiscussion = new Y.Map<unknown>()
    ydiscussion.set('id', discussion.id)
    ydiscussion.set('author', this.createYAuthor(discussion.author))
    ydiscussion.set('title', discussion.title)
    ydiscussion.set('text', discussion.text)
    ydiscussion.set('createdAt', discussion.createdAt)
    ydiscussion.set('resolved', discussion.resolved)
    const thread = new Y.Array<Y.Map<unknown>>()
    for (const reply of discussion.thread) {
      const yreply = new Y.Map<unknown>()
      yreply.set('author', this.createYAuthor(reply.author))
      yreply.set('text', reply.text)
      yreply.set('createdAt', reply.createdAt)
      thread.push([yreply])
    }
    ydiscussion.set('thread', thread)
    return ydiscussion
  }

  private createYAuthor(author: SidecarAuthor): Y.Map<unknown> {
    const yauthor = new Y.Map<unknown>()
    yauthor.set('userId', author.userId)
    yauthor.set('name', author.name)
    return yauthor
  }

  private syncThread(discussion: Y.Map<unknown>, incoming: SidecarReply[]): void {
    const current = discussion.get('thread')
    const thread =
      current instanceof Y.Array
        ? (current as Y.Array<Y.Map<unknown>>)
        : new Y.Array<Y.Map<unknown>>()
    if (!(current instanceof Y.Array)) discussion.set('thread', thread)

    const signatures = new Set<string>()
    for (const value of thread.toArray()) {
      if (!(value instanceof Y.Map)) continue
      signatures.add(
        this.replySignature({
          author: this.readAuthor(value.get('author')),
          text: this.asString(value.get('text')),
          createdAt: this.asString(value.get('createdAt')),
        }),
      )
    }

    for (const reply of incoming) {
      const signature = this.replySignature(reply)
      if (signatures.has(signature)) continue
      const yreply = new Y.Map<unknown>()
      yreply.set('author', this.createYAuthor(reply.author))
      yreply.set('text', reply.text)
      yreply.set('createdAt', reply.createdAt)
      thread.push([yreply])
      signatures.add(signature)
    }
  }

  private serializeFromCrdt(): SidecarPayload {
    const discussions: SidecarDiscussion[] = []
    for (const value of this.ydiscussions.toArray()) {
      const discussion = this.serializeDiscussion(value)
      if (discussion) discussions.push(discussion)
    }

    return {
      documentPath: this.documentPath,
      discussions,
    }
  }

  private hasSerializableDiscussions(): boolean {
    for (const value of this.ydiscussions.toArray()) {
      if (this.serializeDiscussion(value)) return true
    }
    return false
  }

  private syncMentionsToTriggerFiles(): void {
    for (const value of this.ydiscussions.toArray()) {
      if (!(value instanceof Y.Map)) continue
      const discussionId = this.asString(value.get('id')).trim()
      const title = this.asString(value.get('title')).trim()
      const text = this.asString(value.get('text')).trim()
      if (!discussionId || !title || !text) continue

      for (const agent of this.extractMentionedAgents(text)) {
        const signature = `${discussionId}\u0000root\u0000${agent}`
        if (this.processedMentions.has(signature)) continue
        this.writeMentionTriggerFile({
          discussion: value,
          discussionId,
          mentionedAgent: agent,
          anchorText: text,
          signature,
        })
      }

      const thread = value.get('thread')
      if (!(thread instanceof Y.Array)) continue
      for (const entry of thread.toArray()) {
        if (!(entry instanceof Y.Map)) continue
        const replyText = this.asString(entry.get('text')).trim()
        if (!replyText) continue
        const replySignature = this.replySignature({
          author: this.readAuthor(entry.get('author')),
          text: replyText,
          createdAt: this.asString(entry.get('createdAt')),
        })
        for (const agent of this.extractMentionedAgents(replyText)) {
          const signature = `${discussionId}\u0000reply\u0000${replySignature}\u0000${agent}`
          if (this.processedMentions.has(signature)) continue
          this.writeMentionTriggerFile({
            discussion: value,
            discussionId,
            mentionedAgent: agent,
            anchorText: replyText,
            signature,
          })
        }
      }
    }
  }

  private writeMentionTriggerFile(input: {
    discussion: Y.Map<unknown>
    discussionId: string
    mentionedAgent: string
    anchorText: string
    signature: string
  }): void {
    const payload = this.buildAgentTriggerPayload(
      input.discussion,
      input.discussionId,
      input.mentionedAgent,
      input.anchorText,
    )
    const relativePath = this.getAgentTriggerRelativePath(input.discussionId)
    const triggerPath = join(this.workDir, relativePath)

    mkdirSync(dirname(triggerPath), { recursive: true })
    try {
      writeFileSync(triggerPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
      this.processedMentions.add(input.signature)
      this.onTriggerCreated?.(relativePath)
    } catch {
      // Keep daemon running.
    }
  }

  private buildAgentTriggerPayload(
    discussion: Y.Map<unknown>,
    discussionId: string,
    mentionedAgent: string,
    anchorText: string,
  ): AgentTriggerPayload {
    const ytext = this.ydoc.getText('codemirror').toString()
    const lines = ytext.split('\n')
    const surroundingContext = lines.slice(0, Math.min(lines.length, 11)).join('\n')

    return {
      discussionId,
      mentionedAgent,
      discussionTitle: this.asString(discussion.get('title')),
      discussionText: this.asString(discussion.get('text')),
      anchorText,
      surroundingContext,
    }
  }

  private getAgentTriggerRelativePath(discussionId: string): string {
    const normalizedDocPath = this.documentPath.replace(/\\/g, '/')
    return `.collabmd/agent-triggers/${normalizedDocPath}/discussion-${discussionId}.json`
  }

  private extractMentionedAgents(value: string): string[] {
    const matches = value.matchAll(/@([a-zA-Z0-9_-]+)/g)
    const agents = new Set<string>()
    for (const match of matches) {
      const name = (match[1] ?? '').trim()
      if (!name) continue
      agents.add(name)
    }
    return Array.from(agents)
  }

  private getDiscussionMapById(): Map<string, Y.Map<unknown>> {
    const discussions = new Map<string, Y.Map<unknown>>()
    for (const value of this.ydiscussions.toArray()) {
      if (!(value instanceof Y.Map)) continue
      const id = this.asString(value.get('id')).trim()
      if (!id) continue
      discussions.set(id, value)
    }
    return discussions
  }

  private serializeDiscussion(value: unknown): SidecarDiscussion | null {
    if (!(value instanceof Y.Map)) return null
    const id = this.asString(value.get('id')).trim()
    const title = this.asString(value.get('title')).trim()
    const text = this.asString(value.get('text')).trim()
    if (!id || !title || !text) return null

    return {
      id,
      author: this.readAuthor(value.get('author')),
      title,
      text,
      createdAt: this.asString(value.get('createdAt')),
      resolved: value.get('resolved') === true,
      thread: this.readThread(value.get('thread')),
    }
  }

  private parseDiscussion(value: unknown): SidecarDiscussion | null {
    if (!value || typeof value !== 'object') return null
    const candidate = value as Record<string, unknown>
    const id = this.asString(candidate.id).trim()
    const title = this.asString(candidate.title).trim()
    const text = this.asString(candidate.text).trim()
    if (!id || !title || !text) return null

    return {
      id,
      author: this.parseAuthor(candidate.author),
      title,
      text,
      createdAt: this.asString(candidate.createdAt) || new Date().toISOString(),
      resolved: candidate.resolved === true,
      thread: this.parseThread(candidate.thread),
    }
  }

  private parseAuthor(value: unknown): SidecarAuthor {
    if (!value || typeof value !== 'object') return { userId: '', name: '' }
    const candidate = value as Record<string, unknown>
    return {
      userId: this.asString(candidate.userId),
      name: this.asString(candidate.name),
    }
  }

  private readAuthor(value: unknown): SidecarAuthor {
    if (!(value instanceof Y.Map)) return { userId: '', name: '' }
    return {
      userId: this.asString(value.get('userId')),
      name: this.asString(value.get('name')),
    }
  }

  private parseThread(value: unknown): SidecarReply[] {
    if (!Array.isArray(value)) return []
    const thread: SidecarReply[] = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Record<string, unknown>
      const text = this.asString(candidate.text).trim()
      if (!text) continue
      thread.push({
        author: this.parseAuthor(candidate.author),
        text,
        createdAt: this.asString(candidate.createdAt) || new Date().toISOString(),
      })
    }
    return thread
  }

  private readThread(value: unknown): SidecarReply[] {
    if (!(value instanceof Y.Array)) return []
    const thread: SidecarReply[] = []
    for (const entry of value.toArray()) {
      if (!(entry instanceof Y.Map)) continue
      const text = this.asString(entry.get('text')).trim()
      if (!text) continue
      thread.push({
        author: this.readAuthor(entry.get('author')),
        text,
        createdAt: this.asString(entry.get('createdAt')),
      })
    }
    return thread
  }

  private replySignature(value: SidecarReply): string {
    return `${value.author.userId}\u0000${value.author.name}\u0000${value.text}\u0000${value.createdAt}`
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}
