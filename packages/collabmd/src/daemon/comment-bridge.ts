import { createHash } from 'crypto'
import { dirname, join, basename } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as Y from 'yjs'
import type { FileWatcher } from './file-watcher.js'

const COMMENT_BRIDGE_ORIGIN = 'comment-bridge'
const SUGGESTION_ACCEPT_ORIGIN = 'suggestion-accept'
const SUGGESTION_DISMISS_ORIGIN = 'suggestion-dismiss'
const DEFAULT_WRITE_DEBOUNCE_MS = 200

interface SidecarThreadEntry {
  author: string
  text: string
  createdAt: string
}

interface SidecarSuggestion {
  originalText: string
  proposedText: string
  status: 'pending' | 'accepted' | 'dismissed'
}

interface SidecarComment {
  id: string
  line: number
  endLine: number
  author: string
  source: 'browser' | 'daemon'
  text: string
  createdAt: string
  resolved: boolean
  thread: SidecarThreadEntry[]
  suggestion?: SidecarSuggestion
}

interface SidecarPayload {
  documentPath: string
  comments: SidecarComment[]
}

interface ParsedSidecarComment {
  id: string
  line: number
  endLine: number
  author: string
  source: 'browser' | 'daemon'
  text: string
  createdAt: string
  resolved: boolean
  thread: SidecarThreadEntry[]
  suggestion?: SidecarSuggestion
}

interface AgentTriggerPayload {
  commentId: string
  mentionedAgent: string
  commentText: string
  anchorText: string
  surroundingContext: string
}

export class CommentBridge {
  private ydoc: Y.Doc
  private ytext: Y.Text
  private ycomments: Y.Array<Y.Map<unknown>>
  private workDir: string
  private documentPath: string
  private sidecarPath: string
  private sidecarRelativePath: string
  private fileWatcher: FileWatcher
  private writeDebounceMs: number
  private writeTimer: NodeJS.Timeout | null = null
  private observer: ((events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void) | null = null
  private lastSidecarHash = ''
  private processedMentions = new Set<string>()
  private responseHashes = new Map<string, string>()
  private onTriggerCreated?: (triggerRelativePath: string) => void

  constructor(options: {
    ydoc: Y.Doc
    ytext: Y.Text
    ycomments: Y.Array<Y.Map<unknown>>
    workDir: string
    documentPath: string
    sidecarPath: string
    sidecarRelativePath: string
    fileWatcher: FileWatcher
    writeDebounceMs?: number
    onTriggerCreated?: (triggerRelativePath: string) => void
  }) {
    this.ydoc = options.ydoc
    this.ytext = options.ytext
    this.ycomments = options.ycomments
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
    if (existsSync(this.sidecarPath) || this.hasSerializableComments()) {
      this.writeToSidecar()
    }
    this.setupObserver()
  }

  onCommentFileChange(): void {
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
      commentId?: unknown
      replyText?: unknown
      text?: unknown
      author?: unknown
      mentionedAgent?: unknown
      resolved?: unknown
    }

    const commentId = this.asString(payload.commentId).trim() || basename(responseRelativePath, '.response.json')
    const text = this.asString(payload.replyText).trim() || this.asString(payload.text).trim()
    if (!commentId || !text) return
    const author = this.asString(payload.author).trim()
      || this.asString(payload.mentionedAgent).trim()
      || 'Agent'
    const createdAt = new Date().toISOString()
    const shouldResolve = payload.resolved === true

    const comment = this.getCommentMapById().get(commentId)
    if (!comment) return

    this.ydoc.transact(() => {
      const threadValue = comment.get('thread')
      const thread = threadValue instanceof Y.Array
        ? threadValue as Y.Array<Y.Map<unknown>>
        : new Y.Array<Y.Map<unknown>>()
      if (!(threadValue instanceof Y.Array)) comment.set('thread', thread)

      const reply = new Y.Map<unknown>()
      reply.set('authorId', author)
      reply.set('authorName', author)
      reply.set('text', text)
      reply.set('createdAt', createdAt)
      thread.push([reply])
      if (shouldResolve) comment.set('resolved', true)
    }, COMMENT_BRIDGE_ORIGIN)

    this.responseHashes.set(responseRelativePath, nextHash)
  }

  destroy(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }

    if (this.observer) {
      this.ycomments.unobserveDeep(this.observer)
      this.observer = null
    }
  }

  private setupObserver(): void {
    this.observer = (_events, transaction) => {
      if (transaction.origin === COMMENT_BRIDGE_ORIGIN) return
      this.syncMentionsToTriggerFiles()
      this.scheduleWrite()
    }

    this.ycomments.observeDeep(this.observer)
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

    let raw: string
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
      console.warn(`[CommentBridge] Invalid JSON in ${this.sidecarRelativePath}; skipping.`)
      return
    }

    if (!parsed || typeof parsed !== 'object') {
      console.warn(`[CommentBridge] Invalid sidecar payload in ${this.sidecarRelativePath}; skipping.`)
      return
    }

    const payload = parsed as { comments?: unknown }
    if (!Array.isArray(payload.comments)) {
      console.warn(`[CommentBridge] Missing comments array in ${this.sidecarRelativePath}; skipping.`)
      return
    }

    this.applySidecarDiff(payload.comments)
    this.lastSidecarHash = nextHash
  }

  private applySidecarDiff(rawComments: unknown[]): void {
    const incoming = rawComments
      .map((value) => this.parseSidecarComment(value))
      .filter((value): value is ParsedSidecarComment => value !== null)

    const existing = this.getCommentMapById()
    const incomingIds = new Set(incoming.map((comment) => comment.id))
    const suggestionActions: Array<{ commentId: string; status: 'accepted' | 'dismissed' }> = []

    this.ydoc.transact(() => {
      for (const comment of incoming) {
        const current = existing.get(comment.id)
        if (!current) {
          const created = this.createYComment(comment)
          this.ycomments.push([created])
          if (comment.suggestion?.status === 'accepted' || comment.suggestion?.status === 'dismissed') {
            const createdSuggestion = created.get('suggestion')
            if (createdSuggestion instanceof Y.Map) {
              createdSuggestion.set('status', 'pending')
            }
            suggestionActions.push({ commentId: comment.id, status: comment.suggestion.status })
          }
          continue
        }

        const resolved = current.get('resolved')
        if (typeof resolved !== 'boolean' || resolved !== comment.resolved) {
          current.set('resolved', comment.resolved)
        }

        this.syncThreadReplies(current, comment.thread)
        this.syncSuggestion(current, comment.suggestion)
        this.collectSuggestionActions(current, comment.suggestion, suggestionActions)
      }

      for (const [id, current] of existing) {
        if (incomingIds.has(id)) continue
        if (current.get('resolved') === true) continue
        current.set('resolved', true)
      }
    }, COMMENT_BRIDGE_ORIGIN)

    for (const action of suggestionActions) {
      const comment = this.getCommentMapById().get(action.commentId)
      if (!comment) continue
      if (action.status === 'accepted') {
        this.acceptSuggestionInYComment(comment)
      } else {
        this.dismissSuggestionInYComment(comment)
      }
    }
  }

  private getCommentMapById(): Map<string, Y.Map<unknown>> {
    const comments = new Map<string, Y.Map<unknown>>()

    for (const value of this.ycomments.toArray()) {
      if (!(value instanceof Y.Map)) continue
      const id = this.asString(value.get('id')).trim()
      if (!id) continue
      comments.set(id, value)
    }

    return comments
  }

  private createYComment(comment: ParsedSidecarComment): Y.Map<unknown> {
    const ycomment = new Y.Map<unknown>()
    const startIndex = this.indexAtLineStart(comment.line)
    const endIndex = this.indexAtLineStart(comment.endLine)

    ycomment.set('id', comment.id)
    ycomment.set('anchorStart', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(this.ytext, startIndex)))
    ycomment.set('anchorEnd', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(this.ytext, endIndex)))
    ycomment.set('authorId', comment.author)
    ycomment.set('authorName', comment.author)
    ycomment.set('source', comment.source)
    ycomment.set('text', comment.text)
    ycomment.set('createdAt', comment.createdAt)
    ycomment.set('resolved', comment.resolved)
    if (comment.suggestion) {
      ycomment.set('suggestion', this.createYSuggestion(comment.suggestion))
    }

    const thread = new Y.Array<Y.Map<unknown>>()
    for (const reply of comment.thread) {
      const yreply = new Y.Map<unknown>()
      yreply.set('authorId', reply.author)
      yreply.set('authorName', reply.author)
      yreply.set('text', reply.text)
      yreply.set('createdAt', reply.createdAt)
      thread.push([yreply])
    }
    ycomment.set('thread', thread)

    return ycomment
  }

  private createYSuggestion(suggestion: SidecarSuggestion): Y.Map<unknown> {
    const ysuggestion = new Y.Map<unknown>()
    ysuggestion.set('originalText', suggestion.originalText)
    ysuggestion.set('proposedText', suggestion.proposedText)
    ysuggestion.set('status', suggestion.status)
    return ysuggestion
  }

  private syncSuggestion(comment: Y.Map<unknown>, incomingSuggestion: SidecarSuggestion | undefined): void {
    if (!incomingSuggestion) return

    const suggestion = this.ensureSuggestionMap(comment, incomingSuggestion)
    if (!suggestion) return

    suggestion.set('originalText', incomingSuggestion.originalText)
    suggestion.set('proposedText', incomingSuggestion.proposedText)
  }

  private collectSuggestionActions(
    comment: Y.Map<unknown>,
    incomingSuggestion: SidecarSuggestion | undefined,
    actions: Array<{ commentId: string; status: 'accepted' | 'dismissed' }>,
  ): void {
    if (!incomingSuggestion) return

    const previous = comment.get('suggestion')
    const previousStatus = previous instanceof Y.Map
      ? this.asSuggestionStatus(previous.get('status'))
      : null
    const suggestion = this.ensureSuggestionMap(comment, incomingSuggestion)
    if (!suggestion) return

    const currentStatus = previousStatus ?? this.asSuggestionStatus(suggestion.get('status'))
    if (incomingSuggestion.status === 'accepted' && (currentStatus === null || currentStatus === 'pending')) {
      actions.push({ commentId: this.asString(comment.get('id')), status: 'accepted' })
      return
    }
    if (incomingSuggestion.status === 'dismissed' && (currentStatus === null || currentStatus === 'pending')) {
      actions.push({ commentId: this.asString(comment.get('id')), status: 'dismissed' })
      return
    }

    if (currentStatus !== incomingSuggestion.status) {
      suggestion.set('status', incomingSuggestion.status)
    }
    if (incomingSuggestion.status === 'accepted' || incomingSuggestion.status === 'dismissed') {
      comment.set('resolved', true)
    }
  }

  private ensureSuggestionMap(
    comment: Y.Map<unknown>,
    incomingSuggestion: SidecarSuggestion,
  ): Y.Map<unknown> | null {
    const current = comment.get('suggestion')
    if (current instanceof Y.Map) return current as Y.Map<unknown>

    const suggestion = this.createYSuggestion(incomingSuggestion)
    comment.set('suggestion', suggestion)
    return suggestion
  }

  private acceptSuggestionInYComment(comment: Y.Map<unknown>): boolean {
    const suggestion = comment.get('suggestion')
    if (!(suggestion instanceof Y.Map)) return false

    const status = this.asSuggestionStatus(suggestion.get('status'))
    if (status === 'accepted') {
      comment.set('resolved', true)
      return true
    }
    if (status === 'dismissed') return false

    const range = this.getCommentRange(comment)
    if (!range) return false

    const proposedText = this.asString(suggestion.get('proposedText'))
    this.ydoc.transact(() => {
      this.ytext.delete(range.from, range.to - range.from)
      if (proposedText.length > 0) {
        this.ytext.insert(range.from, proposedText)
      }
      suggestion.set('status', 'accepted')
      comment.set('resolved', true)
    }, SUGGESTION_ACCEPT_ORIGIN)

    return true
  }

  private dismissSuggestionInYComment(comment: Y.Map<unknown>): boolean {
    const suggestion = comment.get('suggestion')
    if (!(suggestion instanceof Y.Map)) return false

    const status = this.asSuggestionStatus(suggestion.get('status'))
    if (status === 'dismissed') {
      comment.set('resolved', true)
      return true
    }
    if (status === 'accepted') return false

    this.ydoc.transact(() => {
      suggestion.set('status', 'dismissed')
      comment.set('resolved', true)
    }, SUGGESTION_DISMISS_ORIGIN)

    return true
  }

  private getCommentRange(comment: Y.Map<unknown>): { from: number; to: number } | null {
    const anchorStart = comment.get('anchorStart')
    const anchorEnd = comment.get('anchorEnd')
    if (!(anchorStart instanceof Uint8Array) || !(anchorEnd instanceof Uint8Array)) {
      return null
    }

    try {
      const startRel = Y.decodeRelativePosition(anchorStart)
      const endRel = Y.decodeRelativePosition(anchorEnd)
      const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, this.ydoc)
      const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, this.ydoc)
      if (!startAbs || !endAbs || startAbs.type !== this.ytext || endAbs.type !== this.ytext) {
        return null
      }
      return {
        from: Math.min(startAbs.index, endAbs.index),
        to: Math.max(startAbs.index, endAbs.index),
      }
    } catch {
      return null
    }
  }

  private syncThreadReplies(comment: Y.Map<unknown>, incomingThread: SidecarThreadEntry[]): void {
    const currentThread = comment.get('thread')
    const thread = currentThread instanceof Y.Array
      ? currentThread as Y.Array<Y.Map<unknown>>
      : new Y.Array<Y.Map<unknown>>()
    if (!(currentThread instanceof Y.Array)) comment.set('thread', thread)

    const existingSignatures = new Set<string>()
    for (const value of thread.toArray()) {
      if (!(value instanceof Y.Map)) continue
      const signature = this.replySignature({
        author: this.asString(value.get('authorName')) || this.asString(value.get('authorId')),
        text: this.asString(value.get('text')),
        createdAt: this.asString(value.get('createdAt')),
      })
      existingSignatures.add(signature)
    }

    for (const reply of incomingThread) {
      const signature = this.replySignature(reply)
      if (existingSignatures.has(signature)) continue

      const yreply = new Y.Map<unknown>()
      yreply.set('authorId', reply.author)
      yreply.set('authorName', reply.author)
      yreply.set('text', reply.text)
      yreply.set('createdAt', reply.createdAt)
      thread.push([yreply])
      existingSignatures.add(signature)
    }
  }

  private serializeFromCrdt(): SidecarPayload {
    const comments: SidecarComment[] = []

    for (const value of this.ycomments.toArray()) {
      const comment = this.serializeComment(value)
      if (comment) comments.push(comment)
    }

    return {
      documentPath: this.documentPath,
      comments,
    }
  }

  private hasSerializableComments(): boolean {
    for (const value of this.ycomments.toArray()) {
      if (this.serializeComment(value)) return true
    }
    return false
  }

  private syncMentionsToTriggerFiles(): void {
    for (const value of this.ycomments.toArray()) {
      if (!(value instanceof Y.Map)) continue
      const id = this.asString(value.get('id')).trim()
      const text = this.asString(value.get('text')).trim()
      if (!id || !text) continue

      const mentions = this.extractMentionedAgents(text)
      if (mentions.length === 0) continue

      for (const agent of mentions) {
        const signature = `${id}\u0000${agent}`
        if (this.processedMentions.has(signature)) continue

        const payload = this.buildAgentTriggerPayload(value, id, agent, text)
        const relativePath = this.getAgentTriggerRelativePath(id)
        const triggerPath = join(this.workDir, relativePath)

        mkdirSync(dirname(triggerPath), { recursive: true })
        try {
          writeFileSync(triggerPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
          this.processedMentions.add(signature)
          this.onTriggerCreated?.(relativePath)
        } catch {
          // Keep daemon running.
        }
      }
    }
  }

  private buildAgentTriggerPayload(
    comment: Y.Map<unknown>,
    commentId: string,
    mentionedAgent: string,
    commentText: string,
  ): AgentTriggerPayload {
    const range = this.getCommentRange(comment)
    const content = this.ytext.toString()

    const anchorText = range
      ? content.slice(Math.max(0, range.from), Math.max(0, range.to))
      : ''

    const surroundingContext = range
      ? this.getSurroundingContext(range.from, range.to)
      : content

    return {
      commentId,
      mentionedAgent,
      commentText,
      anchorText,
      surroundingContext,
    }
  }

  private getSurroundingContext(from: number, to: number): string {
    const content = this.ytext.toString()
    if (!content) return ''

    const lines = content.split('\n')
    const startLine = Math.max(1, this.lineFromIndex(from) - 5)
    const endLine = Math.min(lines.length, this.lineFromIndex(to) + 5)
    return lines.slice(startLine - 1, endLine).join('\n')
  }

  private getAgentTriggerRelativePath(commentId: string): string {
    const normalizedDocPath = this.documentPath.replace(/\\/g, '/')
    return `.collabmd/agent-triggers/${normalizedDocPath}/${commentId}.json`
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

  private serializeComment(value: unknown): SidecarComment | null {
    if (!(value instanceof Y.Map)) return null

    const id = this.asString(value.get('id')).trim()
    const anchorStart = value.get('anchorStart')
    const anchorEnd = value.get('anchorEnd')
    const text = this.asString(value.get('text')).trim()

    if (!id || !(anchorStart instanceof Uint8Array) || !(anchorEnd instanceof Uint8Array) || !text) {
      return null
    }

    const source = value.get('source')
    const suggestion = this.serializeSuggestion(value.get('suggestion'))

    return {
      id,
      line: this.lineFromAnchor(anchorStart),
      endLine: this.lineFromAnchor(anchorEnd),
      author: this.asString(value.get('authorName')) || this.asString(value.get('authorId')),
      source: source === 'daemon' ? 'daemon' : 'browser',
      text,
      createdAt: this.asString(value.get('createdAt')),
      resolved: this.asBool(value.get('resolved')),
      thread: this.serializeThread(value.get('thread')),
      suggestion: suggestion ?? undefined,
    }
  }

  private serializeSuggestion(value: unknown): SidecarSuggestion | null {
    if (!(value instanceof Y.Map)) return null

    const status = this.asSuggestionStatus(value.get('status'))
    if (!status) return null

    return {
      originalText: this.asString(value.get('originalText')),
      proposedText: this.asString(value.get('proposedText')),
      status,
    }
  }

  private serializeThread(value: unknown): SidecarThreadEntry[] {
    if (!(value instanceof Y.Array)) return []

    const thread: SidecarThreadEntry[] = []
    for (const entry of value.toArray()) {
      if (!(entry instanceof Y.Map)) continue
      const text = this.asString(entry.get('text')).trim()
      if (!text) continue

      thread.push({
        author: this.asString(entry.get('authorName')) || this.asString(entry.get('authorId')),
        text,
        createdAt: this.asString(entry.get('createdAt')),
      })
    }

    return thread
  }

  private lineFromAnchor(anchor: Uint8Array): number {
    try {
      const relPos = Y.decodeRelativePosition(anchor)
      const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, this.ydoc)
      if (!absPos || absPos.type !== this.ytext) return 1
      return this.lineFromIndex(absPos.index)
    } catch {
      return 1
    }
  }

  private indexAtLineStart(line: number): number {
    const content = this.ytext.toString()
    const starts = this.lineStarts(content)
    const clampedLine = Math.max(1, Math.min(Math.trunc(line) || 1, starts.length))
    return starts[clampedLine - 1] ?? 0
  }

  private lineFromIndex(index: number): number {
    const content = this.ytext.toString()
    const starts = this.lineStarts(content)
    const clampedIndex = Math.max(0, Math.min(index, content.length))

    let line = 1
    for (let i = 1; i < starts.length; i += 1) {
      if (starts[i]! > clampedIndex) break
      line = i + 1
    }

    return line
  }

  private lineStarts(content: string): number[] {
    const starts = [0]
    for (let i = 0; i < content.length; i += 1) {
      if (content[i] === '\n') starts.push(i + 1)
    }
    return starts
  }

  private parseSidecarComment(value: unknown): ParsedSidecarComment | null {
    if (!value || typeof value !== 'object') return null

    const candidate = value as {
      id?: unknown
      line?: unknown
      endLine?: unknown
      author?: unknown
      source?: unknown
      text?: unknown
      createdAt?: unknown
      resolved?: unknown
      thread?: unknown
      suggestion?: unknown
    }

    const id = this.asString(candidate.id).trim()
    const text = this.asString(candidate.text).trim()
    if (!id || !text) return null

    const line = this.asLineNumber(candidate.line)
    const endLineRaw = this.asLineNumber(candidate.endLine)
    const endLine = Math.max(line, endLineRaw)
    const source = candidate.source === 'browser' ? 'browser' : 'daemon'

    return {
      id,
      line,
      endLine,
      author: this.asString(candidate.author),
      source,
      text,
      createdAt: this.asString(candidate.createdAt) || new Date().toISOString(),
      resolved: this.asBool(candidate.resolved),
      thread: this.parseThread(candidate.thread),
      suggestion: this.parseSuggestion(candidate.suggestion) ?? undefined,
    }
  }

  private parseThread(value: unknown): SidecarThreadEntry[] {
    if (!Array.isArray(value)) return []

    const thread: SidecarThreadEntry[] = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as { author?: unknown; text?: unknown; createdAt?: unknown }
      const text = this.asString(candidate.text).trim()
      if (!text) continue

      thread.push({
        author: this.asString(candidate.author),
        text,
        createdAt: this.asString(candidate.createdAt) || new Date().toISOString(),
      })
    }

    return thread
  }

  private parseSuggestion(value: unknown): SidecarSuggestion | null {
    if (!value || typeof value !== 'object') return null

    const candidate = value as {
      originalText?: unknown
      proposedText?: unknown
      status?: unknown
    }

    const status = this.asSuggestionStatus(candidate.status)
    if (!status) return null

    return {
      originalText: this.asString(candidate.originalText),
      proposedText: this.asString(candidate.proposedText),
      status,
    }
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  private asBool(value: unknown): boolean {
    return typeof value === 'boolean' ? value : false
  }

  private asLineNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1
    return Math.max(1, Math.trunc(value))
  }

  private asSuggestionStatus(value: unknown): SidecarSuggestion['status'] | null {
    if (value === 'pending' || value === 'accepted' || value === 'dismissed') {
      return value
    }
    return null
  }

  private replySignature(value: SidecarThreadEntry): string {
    return `${value.author}\u0000${value.text}\u0000${value.createdAt}`
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}
