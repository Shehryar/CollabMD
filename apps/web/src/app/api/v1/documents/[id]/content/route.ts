import { NextRequest, NextResponse } from 'next/server'
import * as Y from 'yjs'
import diff from 'fast-diff'
import { requireJsonContentType } from '@/lib/http'
import { authorizeAgentForDocument } from '@/lib/agent-doc-access'
import { fetchDocFromSyncServer, replaceDocOnSyncServer } from '@/lib/sync-doc-state'
import { createSuggestionInYArray } from '@/components/editor/use-comments'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params
  const authz = await authorizeAgentForDocument(request, id, 'can_view')
  if ('error' in authz) return authz.error

  const docState = await fetchDocFromSyncServer(id)
  if ('error' in docState) return docState.error

  const content = docState.ydoc.getText('codemirror').toString()
  docState.ydoc.destroy()

  return NextResponse.json({
    documentId: id,
    orgId: authz.document.orgId,
    content,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params
  const authz = await authorizeAgentForDocument(request, id, 'can_edit')
  if ('error' in authz) return authz.error

  const contentTypeError = requireJsonContentType(request)
  if (contentTypeError) return contentTypeError

  const body = await request.json() as { content?: string }
  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
  }
  const content = body.content

  const docState = await fetchDocFromSyncServer(id)
  if ('error' in docState) return docState.error

  if (authz.agentPolicy === 'suggest-only') {
    const ydoc = docState.ydoc
    const ytext = ydoc.getText('codemirror')
    const ycomments = ydoc.getArray<Y.Map<unknown>>('comments')
    const currentContent = ytext.toString()

    const diffs = diff(currentContent, content)

    // Walk through diffs and collect contiguous change regions.
    // Each region accumulates deletions (original) and insertions (proposed)
    // along with cursor positions in the original text.
    let cursor = 0
    let suggestionsCreated = 0

    interface ChangeRegion {
      from: number
      to: number
      original: string
      proposed: string
    }

    const regions: ChangeRegion[] = []
    let pending: ChangeRegion | null = null

    for (const [type, text] of diffs) {
      if (type === diff.EQUAL) {
        // Flush any pending change region
        if (pending) {
          regions.push(pending)
          pending = null
        }
        cursor += text.length
      } else if (type === diff.DELETE) {
        // Text removed from original
        if (!pending) {
          pending = { from: cursor, to: cursor, original: '', proposed: '' }
        }
        pending.to = cursor + text.length
        pending.original += text
        cursor += text.length
      } else if (type === diff.INSERT) {
        // Text added in proposed
        if (!pending) {
          pending = { from: cursor, to: cursor, original: '', proposed: '' }
        }
        pending.proposed += text
        // cursor does not advance for insertions (they reference the original)
      }
    }

    if (pending) {
      regions.push(pending)
    }

    for (const region of regions) {
      // For pure insertions (no original text), we need at least a 1-char anchor
      // since createSuggestionInYArray requires from !== to.
      // Use the character before the insertion point if possible.
      let from = region.from
      let to = region.to
      let original = region.original
      let proposed = region.proposed

      if (from === to && original === '') {
        // Pure insertion: expand anchor to include one surrounding character
        if (from > 0) {
          from = from - 1
          original = currentContent.charAt(from)
          proposed = original + proposed
          to = from + 1
        } else if (from < currentContent.length) {
          to = from + 1
          original = currentContent.charAt(from)
          proposed = proposed + original
        } else {
          // Empty document, cannot anchor a suggestion
          continue
        }
      }

      const commentId = createSuggestionInYArray({
        ydoc,
        ytext,
        ycomments,
        from,
        to,
        authorId: authz.context.actorId,
        authorName: authz.context.name,
        text: 'Suggestion',
        source: 'browser',
        originalText: original,
        proposedText: proposed,
      })

      if (commentId) {
        suggestionsCreated++
      }
    }

    const replaceError = await replaceDocOnSyncServer(id, ydoc)
    ydoc.destroy()
    if (replaceError) return replaceError

    return NextResponse.json({ ok: true, suggestions: suggestionsCreated })
  }

  const ytext = docState.ydoc.getText('codemirror')
  docState.ydoc.transact(() => {
    ytext.delete(0, ytext.length)
    if (content.length > 0) ytext.insert(0, content)
  }, `agent-key:${authz.context.keyId}`)

  const replaceError = await replaceDocOnSyncServer(id, docState.ydoc)
  docState.ydoc.destroy()
  if (replaceError) return replaceError

  return NextResponse.json({ ok: true })
}
