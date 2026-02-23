import { NextRequest, NextResponse } from 'next/server'
import * as Y from 'yjs'
import { requireJsonContentType } from '@/lib/http'
import { authorizeAgentForDocument } from '@/lib/agent-doc-access'
import { fetchDocFromSyncServer, replaceDocOnSyncServer } from '@/lib/sync-doc-state'
import { createSuggestionInYArray } from '@/components/editor/use-comments'

type RouteParams = { params: Promise<{ id: string }> }

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
    anchorText?: string
    proposedText?: string
    note?: string
  }

  if (typeof body.anchorText !== 'string' || !body.anchorText) {
    return NextResponse.json({ error: 'anchorText must be a non-empty string' }, { status: 400 })
  }
  if (typeof body.proposedText !== 'string') {
    return NextResponse.json({ error: 'proposedText must be a string' }, { status: 400 })
  }

  const anchorText = body.anchorText
  const proposedText = body.proposedText
  const note = typeof body.note === 'string' ? body.note.trim() : 'Suggestion'

  const docState = await fetchDocFromSyncServer(id)
  if ('error' in docState) return docState.error

  const ydoc = docState.ydoc
  const ytext = ydoc.getText('codemirror')
  const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
  const content = ytext.toString()

  // Find all occurrences of anchorText in the document
  const matches: number[] = []
  let searchFrom = 0
  while (true) {
    const idx = content.indexOf(anchorText, searchFrom)
    if (idx === -1) break
    matches.push(idx)
    searchFrom = idx + 1
  }

  if (matches.length === 0) {
    ydoc.destroy()
    return NextResponse.json({ error: 'anchor text not found in document' }, { status: 400 })
  }

  if (matches.length > 1) {
    ydoc.destroy()
    return NextResponse.json(
      { error: `anchor text is ambiguous (${matches.length} matches)` },
      { status: 400 },
    )
  }

  const from = matches[0]
  const to = from + anchorText.length

  const commentId = createSuggestionInYArray({
    ydoc,
    ytext,
    ycomments,
    from,
    to,
    authorId: authz.context.actorId,
    authorName: authz.context.name,
    text: note,
    source: 'browser',
    originalText: anchorText,
    proposedText,
  })

  if (!commentId) {
    ydoc.destroy()
    return NextResponse.json({ error: 'failed to create suggestion' }, { status: 500 })
  }

  const replaceError = await replaceDocOnSyncServer(id, ydoc)
  ydoc.destroy()
  if (replaceError) return replaceError

  return NextResponse.json({ ok: true, commentId }, { status: 201 })
}
