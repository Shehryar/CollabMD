import { NextRequest, NextResponse } from 'next/server'
import * as Y from 'yjs'
import { db, documents, and, eq, isNull, inArray, desc } from '@collabmd/db'
import { authenticateAgentKey } from '@/lib/agent-key-auth'
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getSyncHttpUrl } from '@/lib/sync-url'

const AGENT_KEY_RATE_LIMIT = 100
const AGENT_KEY_RATE_WINDOW_MS = 60_000

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractAnchorText(ydoc: Y.Doc, comment: Y.Map<unknown>): string {
  const ytext = ydoc.getText('codemirror')
  const anchorStart = comment.get('anchorStart')
  const anchorEnd = comment.get('anchorEnd')
  if (!(anchorStart instanceof Uint8Array) || !(anchorEnd instanceof Uint8Array)) return ''
  try {
    const startRel = Y.decodeRelativePosition(anchorStart)
    const endRel = Y.decodeRelativePosition(anchorEnd)
    const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, ydoc)
    const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, ydoc)
    if (!startAbs || !endAbs || startAbs.type !== ytext || endAbs.type !== ytext) return ''
    const from = Math.min(startAbs.index, endAbs.index)
    const to = Math.max(startAbs.index, endAbs.index)
    return ytext.toString().slice(from, to)
  } catch {
    return ''
  }
}

function lineFromIndex(content: string, index: number): number {
  let line = 0
  for (let i = 0; i < Math.min(index, content.length); i++) {
    if (content[i] === '\n') line++
  }
  return line
}

function getSurroundingContext(ydoc: Y.Doc, comment: Y.Map<unknown>): string {
  const ytext = ydoc.getText('codemirror')
  const content = ytext.toString()
  if (!content) return ''
  const anchorStart = comment.get('anchorStart')
  const anchorEnd = comment.get('anchorEnd')
  if (!(anchorStart instanceof Uint8Array) || !(anchorEnd instanceof Uint8Array)) return content
  try {
    const startRel = Y.decodeRelativePosition(anchorStart)
    const endRel = Y.decodeRelativePosition(anchorEnd)
    const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, ydoc)
    const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, ydoc)
    if (!startAbs || !endAbs) return content
    const from = Math.min(startAbs.index, endAbs.index)
    const to = Math.max(startAbs.index, endAbs.index)
    const lines = content.split('\n')
    const startLine = lineFromIndex(content, from)
    const endLine = lineFromIndex(content, to)
    const contextStart = Math.max(0, startLine - 5)
    const contextEnd = Math.min(lines.length, endLine + 5)
    return lines.slice(contextStart, contextEnd).join('\n')
  } catch {
    return content
  }
}

export async function GET(request: NextRequest) {
  const authResult = await authenticateAgentKey(request)
  if ('error' in authResult) return authResult.error

  const rate = rateLimit(
    `agent-key:${authResult.context.keyId}:v1-mentions`,
    AGENT_KEY_RATE_LIMIT,
    AGENT_KEY_RATE_WINDOW_MS,
  )
  if (!rate.success) {
    return rateLimitResponse(rate, AGENT_KEY_RATE_LIMIT)
  }

  const agentName = authResult.context.name
  const documentIdFilter = request.nextUrl.searchParams.get('documentId')

  const conditions = [eq(documents.orgId, authResult.context.orgId), isNull(documents.deletedAt)]

  const scopedDocuments = authResult.context.scopes.documents
  if (Array.isArray(scopedDocuments)) {
    if (scopedDocuments.length === 0) return NextResponse.json([])
    conditions.push(inArray(documents.id, scopedDocuments))
  }

  const scopedFolders = authResult.context.scopes.folders
  if (Array.isArray(scopedFolders)) {
    if (scopedFolders.length === 0) return NextResponse.json([])
    conditions.push(inArray(documents.folderId, scopedFolders))
  }

  if (documentIdFilter) {
    conditions.push(eq(documents.id, documentIdFilter))
  }

  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.updatedAt))
    .limit(1000)
    .offset(0)
    .all()

  const syncHttpUrl = getSyncHttpUrl()
  const mentionPattern = new RegExp('@' + agentName, 'i')

  interface PendingMention {
    documentId: string
    documentTitle: string
    commentId: string
    commentText: string
    anchorText: string
    surroundingContext: string
  }

  const mentions: PendingMention[] = []

  for (const row of rows) {
    let response: Response
    try {
      response = await fetch(`${syncHttpUrl}/snapshot/${encodeURIComponent(row.id)}`, {
        method: 'GET',
        cache: 'no-store',
      })
    } catch {
      continue
    }

    if (!response.ok) continue

    const ydoc = new Y.Doc()
    try {
      const update = new Uint8Array(await response.arrayBuffer())
      Y.applyUpdate(ydoc, update)

      const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
      for (let i = 0; i < ycomments.length; i++) {
        const comment = ycomments.get(i)

        if (comment.get('resolved') === true) continue

        const commentText = asString(comment.get('text'))
        if (!mentionPattern.test(commentText)) continue

        // Check if the agent has already replied in the thread
        const thread = comment.get('thread')
        let hasAgentReply = false
        if (thread instanceof Y.Array) {
          for (let j = 0; j < thread.length; j++) {
            const reply = thread.get(j) as Y.Map<unknown>
            const replyAuthor = asString(reply.get('authorName'))
            if (replyAuthor.toLowerCase() === agentName.toLowerCase()) {
              hasAgentReply = true
              break
            }
          }
        }
        if (hasAgentReply) continue

        mentions.push({
          documentId: row.id,
          documentTitle: row.title ?? '',
          commentId: asString(comment.get('id')),
          commentText,
          anchorText: extractAnchorText(ydoc, comment),
          surroundingContext: getSurroundingContext(ydoc, comment),
        })
      }
    } finally {
      ydoc.destroy()
    }
  }

  return NextResponse.json(mentions)
}
