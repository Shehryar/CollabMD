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

function readAuthor(value: unknown): { userId: string; name: string } {
  if (!(value instanceof Y.Map)) {
    return { userId: '', name: '' }
  }
  return {
    userId: asString(value.get('userId')),
    name: asString(value.get('name')),
  }
}

function serializeDiscussions(ydiscussions: Y.Array<Y.Map<unknown>>) {
  const discussions: Array<Record<string, unknown>> = []
  for (const entry of ydiscussions.toArray()) {
    if (!(entry instanceof Y.Map)) continue
    const thread = entry.get('thread')

    discussions.push({
      id: asString(entry.get('id')),
      author: readAuthor(entry.get('author')),
      title: asString(entry.get('title')),
      text: asString(entry.get('text')),
      createdAt: asString(entry.get('createdAt')),
      resolved: entry.get('resolved') === true,
      thread:
        thread instanceof Y.Array
          ? thread.toArray().flatMap((reply) => {
              if (!(reply instanceof Y.Map)) return []
              return [
                {
                  author: readAuthor(reply.get('author')),
                  text: asString(reply.get('text')),
                  createdAt: asString(reply.get('createdAt')),
                },
              ]
            })
          : [],
    })
  }

  return discussions
}

function findDiscussionById(
  ydiscussions: Y.Array<Y.Map<unknown>>,
  id: string,
): Y.Map<unknown> | null {
  for (const entry of ydiscussions.toArray()) {
    if (!(entry instanceof Y.Map)) continue
    if (entry.get('id') === id) return entry
  }
  return null
}

function createAuthorMap(userId: string, name: string): Y.Map<unknown> {
  const author = new Y.Map<unknown>()
  author.set('userId', userId)
  author.set('name', name)
  return author
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const authz = await authorizeAgentForDocument(request, id, 'can_view')
  if ('error' in authz) return authz.error

  const docState = await fetchDocFromSyncServer(id)
  if ('error' in docState) return docState.error

  const discussions = serializeDiscussions(docState.ydoc.getArray<Y.Map<unknown>>('discussions'))
  docState.ydoc.destroy()
  return NextResponse.json(discussions)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const authz = await authorizeAgentForDocument(request, id, 'can_comment')
  if ('error' in authz) return authz.error

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = (await request.json()) as {
    discussionId?: string
    title?: string
    text?: string
    resolved?: boolean
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  const docState = await fetchDocFromSyncServer(id)
  if ('error' in docState) return docState.error

  const ydoc = docState.ydoc
  const ydiscussions = ydoc.getArray<Y.Map<unknown>>('discussions')
  const now = new Date().toISOString()
  const discussionId = typeof body.discussionId === 'string' ? body.discussionId.trim() : ''

  if (discussionId) {
    const discussion = findDiscussionById(ydiscussions, discussionId)
    if (!discussion) {
      ydoc.destroy()
      return NextResponse.json({ error: 'discussion not found' }, { status: 404 })
    }

    ydoc.transact(() => {
      const reply = new Y.Map<unknown>()
      reply.set('author', createAuthorMap(authz.context.actorId, authz.context.name))
      reply.set('text', text)
      reply.set('createdAt', now)
      const current = discussion.get('thread')
      if (current instanceof Y.Array) {
        current.push([reply])
      } else {
        const thread = new Y.Array<Y.Map<unknown>>()
        thread.push([reply])
        discussion.set('thread', thread)
      }
    }, `agent-key:${authz.context.keyId}`)
  } else {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      ydoc.destroy()
      return NextResponse.json(
        { error: 'title is required when creating a discussion' },
        { status: 400 },
      )
    }

    ydoc.transact(() => {
      const discussion = new Y.Map<unknown>()
      discussion.set('id', crypto.randomUUID())
      discussion.set('author', createAuthorMap(authz.context.actorId, authz.context.name))
      discussion.set('title', title)
      discussion.set('text', text)
      discussion.set('createdAt', now)
      discussion.set('resolved', body.resolved === true)
      discussion.set('thread', new Y.Array<Y.Map<unknown>>())
      ydiscussions.push([discussion])
    }, `agent-key:${authz.context.keyId}`)
  }

  const replaceError = await replaceDocOnSyncServer(id, ydoc)
  ydoc.destroy()
  if (replaceError) return replaceError

  return NextResponse.json({ ok: true }, { status: 201 })
}
