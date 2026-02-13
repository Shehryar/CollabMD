import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import diff from 'fast-diff'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { FileWatcher } from './file-watcher.js'

export class CrdtBridge {
  private filePath: string
  private relativePath: string
  private ytext: Y.Text
  private ydoc: Y.Doc
  private awareness: Awareness
  private fileWatcher: FileWatcher
  private lastKnownContent = ''
  private lastContentHash = ''
  private observer: ((event: Y.YTextEvent, transaction: Y.Transaction) => void) | null = null

  constructor(options: {
    filePath: string
    relativePath: string
    ydoc: Y.Doc
    awareness: Awareness
    fileWatcher: FileWatcher
  }) {
    this.filePath = options.filePath
    this.relativePath = options.relativePath
    this.ydoc = options.ydoc
    this.ytext = options.ydoc.getText('codemirror')
    this.awareness = options.awareness
    this.fileWatcher = options.fileWatcher
  }

  initialize(): void {
    const crdtContent = this.ytext.toString()
    const fileExists = existsSync(this.filePath)
    const fileContent = fileExists ? readFileSync(this.filePath, 'utf-8') : ''

    if (crdtContent.length > 0) {
      // CRDT has content (server wins) - write to file
      if (fileContent !== crdtContent) {
        this.writeToFile(crdtContent)
      }
      this.lastKnownContent = crdtContent
    } else if (fileContent.length > 0) {
      // File has content, CRDT empty - load file into CRDT
      this.ydoc.transact(() => {
        this.ytext.insert(0, fileContent)
      }, 'file-change')
      this.lastKnownContent = fileContent
    }

    this.lastContentHash = this.hash(this.lastKnownContent)
    this.setupObserver()
  }

  onFileChange(): void {
    let content: string
    try {
      content = readFileSync(this.filePath, 'utf-8')
    } catch {
      // File may have been moved/unlinked during atomic save.
      return
    }
    const contentHash = this.hash(content)

    if (contentHash === this.lastContentHash) return

    const diffs = diff(this.lastKnownContent, content)
    let pos = 0
    let cursorIndex: number | null = null

    this.ydoc.transact(() => {
      for (const [op, text] of diffs) {
        if (op === 0) {
          pos += text.length
        } else if (op === 1) {
          this.ytext.insert(pos, text)
          pos += text.length
          cursorIndex = pos
        } else if (op === -1) {
          this.ytext.delete(pos, text.length)
          cursorIndex = pos
        }
      }
    }, 'file-change')

    const relPos = Y.createRelativePositionFromTypeIndex(this.ytext, cursorIndex ?? pos)
    this.awareness.setLocalStateField('cursor', { anchor: relPos, head: relPos })

    this.lastKnownContent = content
    this.lastContentHash = contentHash
  }

  private setupObserver(): void {
    this.observer = (_event, transaction) => {
      if (transaction.origin === 'file-change' || transaction.local) return

      const content = this.ytext.toString()
      if (this.hash(content) === this.lastContentHash) return

      this.writeToFile(content)
    }

    this.ytext.observe(this.observer)
  }

  private writeToFile(content: string): void {
    this.fileWatcher.addSuppression(this.relativePath)

    try {
      writeFileSync(this.filePath, content, 'utf-8')
      this.lastKnownContent = content
      this.lastContentHash = this.hash(content)
    } finally {
      this.fileWatcher.removeSuppression(this.relativePath)
    }
  }

  private hash(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  destroy(): void {
    if (this.observer) {
      this.ytext.unobserve(this.observer)
      this.observer = null
    }
  }
}
