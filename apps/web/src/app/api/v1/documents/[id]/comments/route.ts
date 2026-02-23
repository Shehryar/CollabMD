import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import * as Y from 'yjs'
import { requireJsonContentType } from '@/lib/http'
import { authorizeAgentForDocument } from '@/lib/agent-doc-access'
import { fetchDocFromSyncServer, replaceDocOnSyncServer } from '@/lib/sync-doc-state'

type RouteParams = { params: Promise<{ id: string }> }

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function serializeComments(ycomments: Y.Array<Y.Map<unknown>>) {
  const rows: Array<Record<string, unknown>> = []
  for (const value of ycomments.toArray()) {
    if (!(value instanceof Y.Map)) continue

    const suggestion = value.get('suggestion')
    const thread = value.get('thread')
    const row: Record<string, unknown> = {
      id: asString(value.get('id')),
      authorId: asString(value.get('authorId')),
      authorName: asString(value.get('authorName')),
      source: asString(value.get('source')),
      text: asString(value.get('text')),
      createdAt: asString(value.get('createdAt')),
      resolved: value.get('resolved') === true,
      thread: [],
    }

    if (thread instanceof Y.Array) {
      row.thread = thread.toArray().flatMap((entry) => {
        if (!(entry instanceof Y.Map)) return []
        return [{
          authorId: asString(entry.get('authorId')),
          authorName: asString(entry.get('authorName')),
          text: asString(entry.get('text')),
          createdAt: asString(entry.get('createdAt')),
        }]
      })
    }

    if (suggestion instanceof Y.Map) {
      row.suggestion = {
        originalText: asString(suggestion.get('originalText')),
        proposedText: asString(suggestion.get('proposedText')),
        status: asString(suggestion.get('status')),
      }
    }

    rows.push(row)
  }

  return rows
}

function findCommentById(ycomments: Y.Array<Y.Map<unknown>>, id: string): Y.Map<unknown> | null {
  for (const entry of ycomments.toArray()) {
    if (!(entry instanceof Y.Map)) continue
    if (entry.get('id') === id) return entry
  }
  return null
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params
  const authz = await authorizeAgentForDocument(request, id, 'can_view')
  if ('error' in authz) return authz.error

  const docState = await fetchDocFromSyncServer(id)
  if ('error' in docState) return docState.error

  const comments = serializeComments(docState.ydoc.getArray<Y.Map<unknown>>('comments'))
  docState.ydoc.destroy()
  return NextResponse.json(comments)
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params
  const authz = await authorizeAgentForDocument(request, id, 'can_comment')
  if ('error' in authz) return authz.error

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = await request.json() as {
    text?: string
    from?: number
    to?: number
    commentId?: string
    suggestion?: {
      originalText?: string
      proposedText?: string
    }
  }

  const docState = await fetchDocFromSyncServer(id)
  if ('error' in docState) return docState.error

  const ydoc = docState.ydoc
  const ytext = ydoc.getText('codemirror')
  const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')

  const createdAt = new Date().toISOString()
  let createdCommentId: string | null = null

  if (typeof body.commentId === 'string' && body.commentId.trim()) {
    const target = findCommentById(ycomments, body.commentId.trim())
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!target || !text) {
      ydoc.destroy()
      return NextResponse.json({ error: 'commentId and non-empty text are required for replies' }, { status: 400 })
    }

    ydoc.transact(() => {
      const reply = new Y.Map<unknown>()
      reply.set('authorId', authz.context.actorId)
      reply.set('authorName', authz.context.name)
      reply.set('text', text)
      reply.set('createdAt', createdAt)
      const current = target.get('thread')
      if (current instanceof Y.Array) {
        current.push([reply])
      } else {
        const thread = new Y.Array<Y.Map<unknown>>()
        thread.push([reply])
        target.set('thread', thread)
      }
    }, `agent-key:${authz.context.keyId}`)
  } else {
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const from = typeof body.from === 'number' && Number.isFinite(body.from) ? Math.trunc(body.from) : NaN
    const to = typeof body.to === 'number' && Number.isFinite(body.to) ? Math.trunc(body.to) : NaN
    if (!text || Number.isNaN(from) || Number.isNaN(to) || from < 0 || to < 0 || from === to) {
      ydoc.destroy()
      return NextResponse.json({ error: 'text, from and to are required' }, { status: 400 })
    }

    const start = Math.max(0, Math.min(from, to))
    const end = Math.max(start, Math.max(from, to))
    createdCommentId = crypto.randomUUID()

    ydoc.transact(() => {
      const comment = new Y.Map<unknown>()
      comment.set('id', createdCommentId)
      comment.set('anchorStart', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, start)))
      comment.set('anchorEnd', Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, end)))
      comment.set('authorId', authz.context.actorId)
      comment.set('authorName', authz.context.name)
      comment.set('source', 'agent')
      comment.set('text', text)
      comment.set('createdAt', createdAt)
      comment.set('resolved', false)
      comment.set('thread', new Y.Array<Y.Map<unknown>>())

      if (body.suggestion && typeof body.suggestion === 'object') {
        const suggestion = new Y.Map<unknown>()
        suggestion.set('originalText', asString(body.suggestion.originalText))
        suggestion.set('proposedText', asString(body.suggestion.proposedText))
        suggestion.set('status', 'pending')
        comment.set('suggestion', suggestion)
      }

      ycomments.push([comment])
    }, `agent-key:${authz.context.keyId}`)
  }

  const replaceError = await replaceDocOnSyncServer(id, ydoc)
  ydoc.destroy()
  if (replaceError) return replaceError

  return NextResponse.json({ ok: true, commentId: createdCommentId }, { status: 201 })
}
