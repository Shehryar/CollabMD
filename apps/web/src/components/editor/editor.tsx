'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { yCollab } from 'y-codemirror.next'
import type { SelectionRange } from '@codemirror/state'
import type { YjsContext } from './use-yjs'
import {
  markdownPreviewPlugin,
  markdownPreviewTheme,
  previewEnabled,
  togglePreviewEffect,
} from './markdown-preview'
import { formattingKeymap } from './formatting-commands'
import FormattingToolbar from './formatting-toolbar'
import CommentPanel from './comment-panel'
import CommentInput from './comment-input'
import { createCommentDecorations, setActiveComment } from './comment-decorations'
import { useComments } from './use-comments'

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono), "JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '32px 48px',
    fontFamily: 'var(--font-sans), "Plus Jakarta Sans", system-ui, sans-serif',
    fontSize: '15px',
    lineHeight: '1.7',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: '#999',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#bbb',
  },
  '.cm-activeLine': {
    backgroundColor: '#f7f7f5',
  },
  '.cm-cursor': {
    borderLeftColor: '#111',
    borderLeftWidth: '2px',
  },
  '.cm-ySelectionInfo': {
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    padding: '1px 4px',
    borderRadius: '3px 3px 3px 0',
    opacity: '1',
  },
})

interface SelectionAnchor {
  from: number
  to: number
  buttonLeft: number
  buttonTop: number
  popoverLeft: number
  popoverTop: number
}

type ComposerMode = 'comment' | 'suggest'

interface CollabEditorProps {
  yjs: YjsContext
  readOnly?: boolean
  canEdit?: boolean
  canComment?: boolean
  canResolveComments?: boolean
  currentUser?: {
    id: string
    name: string
  }
}

function getSelectedRange(selection: SelectionRange): { from: number; to: number } | null {
  if (selection.empty) return null
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from === to) return null
  return { from, to }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getSelectionAnchor(view: EditorView, from: number, to: number): SelectionAnchor | null {
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)
  if (!start || !end) return null

  const center = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
  const top = Math.min(start.top, end.top)
  const bottom = Math.max(start.bottom, end.bottom)

  const popoverWidth = 288
  const buttonWidth = 190
  const viewportWidth = window.innerWidth

  const popoverLeft = clamp(center - popoverWidth / 2, 12, viewportWidth - popoverWidth - 12)
  const topPosition = top - 166
  const popoverTop = topPosition > 10 ? topPosition : bottom + 10
  const buttonLeft = clamp(center - buttonWidth / 2, 12, viewportWidth - buttonWidth - 12)

  return {
    from,
    to,
    buttonLeft,
    buttonTop: bottom + 8,
    popoverLeft,
    popoverTop,
  }
}

function sameAnchor(a: SelectionAnchor | null, b: SelectionAnchor | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.from === b.from &&
    a.to === b.to &&
    Math.abs(a.buttonLeft - b.buttonLeft) < 1 &&
    Math.abs(a.buttonTop - b.buttonTop) < 1 &&
    Math.abs(a.popoverLeft - b.popoverLeft) < 1 &&
    Math.abs(a.popoverTop - b.popoverTop) < 1
  )
}

export default function CollabEditor({
  yjs,
  readOnly = false,
  canEdit,
  canComment,
  canResolveComments,
  currentUser,
}: CollabEditorProps) {
  const editable = canEdit ?? !readOnly
  const commentable = canComment ?? editable
  const canResolve = canResolveComments ?? editable

  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [view, setView] = useState<EditorView | null>(null)
  const [previewMode, setPreviewMode] = useState(true)
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null)
  const [commentInputOpen, setCommentInputOpen] = useState(false)
  const [composerMode, setComposerMode] = useState<ComposerMode>('comment')
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const previousCommentCountRef = useRef(0)

  const commentInputOpenRef = useRef(commentInputOpen)
  const openComposerFromSelectionRef = useRef<(view: EditorView, mode?: ComposerMode) => boolean>(() => false)

  const author = useMemo(() => ({
    id: currentUser?.id ?? 'anonymous',
    name: currentUser?.name?.trim() || 'Anonymous',
  }), [currentUser?.id, currentUser?.name])

  const {
    comments,
    createComment,
    createSuggestion,
    replyToComment,
    setResolved,
    acceptSuggestion,
    dismissSuggestion,
    getAbsoluteRange,
  } = useComments({
    ydoc: yjs.ydoc,
    ytext: yjs.ytext,
    ycomments: yjs.ycomments,
    currentUser: author,
    canComment: commentable,
    canResolve,
    canEdit: editable,
  })

  const suggestionCount = useMemo(
    () => comments.reduce((count, comment) => count + (comment.suggestion ? 1 : 0), 0),
    [comments],
  )
  const regularCommentCount = comments.length - suggestionCount

  useEffect(() => {
    commentInputOpenRef.current = commentInputOpen
  }, [commentInputOpen])

  useEffect(() => {
    const previousCount = previousCommentCountRef.current
    if (comments.length > 0 && previousCount === 0) {
      setPanelOpen(true)
    }
    if (comments.length === 0) {
      setPanelOpen(false)
      setActiveCommentId(null)
    }
    previousCommentCountRef.current = comments.length
  }, [comments.length])

  useEffect(() => {
    if (!activeCommentId) return
    if (comments.some((comment) => comment.id === activeCommentId)) return
    setActiveCommentId(null)
  }, [activeCommentId, comments])

  const updateSelectionAnchor = useCallback((editorView: EditorView) => {
    if (!commentable) {
      setSelectionAnchor(null)
      return
    }

    const selected = getSelectedRange(editorView.state.selection.main)
    if (!selected) {
      if (!commentInputOpenRef.current) {
        setSelectionAnchor((previous) => (previous ? null : previous))
      }
      return
    }

    const next = getSelectionAnchor(editorView, selected.from, selected.to)
    if (!next) {
      if (!commentInputOpenRef.current) {
        setSelectionAnchor((previous) => (previous ? null : previous))
      }
      return
    }

    if (commentInputOpenRef.current) return

    setSelectionAnchor((previous) => (sameAnchor(previous, next) ? previous : next))
  }, [commentable])

  const openComposerFromSelection = useCallback((editorView: EditorView, mode: ComposerMode = 'comment') => {
    if (!commentable) return false

    const selected = getSelectedRange(editorView.state.selection.main)
    if (!selected) return false

    const nextAnchor = getSelectionAnchor(editorView, selected.from, selected.to)
    if (!nextAnchor) return false

    setSelectionAnchor(nextAnchor)
    setComposerMode(mode)
    setCommentInputOpen(true)
    return true
  }, [commentable])

  openComposerFromSelectionRef.current = openComposerFromSelection

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: yjs.ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        history(),
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        formattingKeymap,
        ...(commentable
          ? [
              keymap.of([
                {
                  key: 'Mod-Shift-m',
                  run: (editorView) => openComposerFromSelectionRef.current(editorView, 'comment'),
                },
              ]),
              EditorView.domEventHandlers({
                contextmenu: (event, editorView) => {
                  const opened = openComposerFromSelectionRef.current(editorView, 'comment')
                  if (!opened) return false
                  event.preventDefault()
                  return true
                },
              }),
            ]
          : []),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.viewportChanged) {
            updateSelectionAnchor(update.view)
          }
        }),
        editorTheme,
        previewEnabled,
        markdownPreviewPlugin,
        markdownPreviewTheme,
        placeholder('Start writing markdown...'),
        createCommentDecorations({
          ydoc: yjs.ydoc,
          ytext: yjs.ytext,
          ycomments: yjs.ycomments,
          onSelectComment: (commentId) => {
            setPanelOpen(true)
            setActiveCommentId(commentId)
          },
        }),
        ...(!editable ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : []),
        yCollab(yjs.ytext, yjs.awareness),
      ],
    })

    const editorView = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = editorView
    setView(editorView)
    updateSelectionAnchor(editorView)

    return () => {
      editorView.destroy()
      viewRef.current = null
      setView(null)
      setSelectionAnchor(null)
      setCommentInputOpen(false)
    }
  }, [editable, commentable, updateSelectionAnchor, yjs])

  useEffect(() => {
    const editorView = viewRef.current
    if (!editorView) return
    setActiveComment(editorView, activeCommentId)
  }, [activeCommentId, view])

  useEffect(() => {
    if (!activeCommentId) return

    const editorView = viewRef.current
    if (!editorView) return

    const range = getAbsoluteRange(activeCommentId)
    if (!range) return

    editorView.focus()
    editorView.dispatch({
      selection: {
        anchor: range.from,
        head: range.to,
      },
      scrollIntoView: true,
    })
  }, [activeCommentId, getAbsoluteRange])

  const handleTogglePreview = useCallback(() => {
    const editorView = viewRef.current
    if (!editorView) return
    const next = !previewMode
    setPreviewMode(next)
    editorView.dispatch({ effects: togglePreviewEffect.of(next) })
  }, [previewMode])

  const handleCreateComment = useCallback((text: string) => {
    if (!selectionAnchor) return

    const commentId = createComment({
      from: selectionAnchor.from,
      to: selectionAnchor.to,
      text,
      source: 'browser',
    })

    if (!commentId) return

    setCommentInputOpen(false)
    setSelectionAnchor(null)
    setPanelOpen(true)
    setActiveCommentId(commentId)
  }, [createComment, selectionAnchor])

  const handleCreateSuggestion = useCallback((proposedText: string) => {
    if (!selectionAnchor) return

    const editorView = viewRef.current
    if (!editorView) return

    const originalText = editorView.state.doc.sliceString(selectionAnchor.from, selectionAnchor.to)
    const commentId = createSuggestion({
      from: selectionAnchor.from,
      to: selectionAnchor.to,
      text: 'Suggested edit',
      originalText,
      proposedText,
      source: 'browser',
    })

    if (!commentId) return

    setCommentInputOpen(false)
    setSelectionAnchor(null)
    setPanelOpen(true)
    setActiveCommentId(commentId)
  }, [createSuggestion, selectionAnchor])

  const handleReply = useCallback((commentId: string, text: string) => {
    replyToComment(commentId, text)
  }, [replyToComment])

  const handleResolve = useCallback((commentId: string) => {
    setResolved(commentId, true)
  }, [setResolved])

  const handleAcceptSuggestion = useCallback((commentId: string) => {
    acceptSuggestion(commentId)
  }, [acceptSuggestion])

  const handleDismissSuggestion = useCallback((commentId: string) => {
    dismissSuggestion(commentId)
  }, [dismissSuggestion])

  const selectedText = useMemo(() => {
    if (!selectionAnchor) return ''
    const editorView = viewRef.current
    if (!editorView) return ''
    return editorView.state.doc.sliceString(selectionAnchor.from, selectionAnchor.to)
  }, [selectionAnchor, view])

  return (
    <div className="flex h-full flex-col">
      {editable && (
        <FormattingToolbar
          view={view}
          previewMode={previewMode}
          onTogglePreview={handleTogglePreview}
        />
      )}
      {!editable && (
        <div className="border-b border-border bg-bg-subtle px-5 py-2 text-center font-mono text-xs text-fg-muted">
          {commentable ? 'Comment-only access: editing is disabled' : 'You have view-only access to this document'}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />

          {commentable && selectionAnchor && !commentInputOpen && (
            <div
              className="fixed z-30 flex items-center gap-1"
              style={{
                left: `${selectionAnchor.buttonLeft}px`,
                top: `${selectionAnchor.buttonTop}px`,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  const editorView = viewRef.current
                  if (!editorView) return
                  openComposerFromSelection(editorView, 'comment')
                }}
                className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-accent-text shadow-sm"
              >
                Comment
              </button>
              <button
                type="button"
                onClick={() => {
                  const editorView = viewRef.current
                  if (!editorView) return
                  openComposerFromSelection(editorView, 'suggest')
                }}
                className="rounded border border-border bg-bg px-2.5 py-1 font-mono text-[11px] text-fg-secondary shadow-sm hover:bg-bg-subtle"
              >
                Suggest
              </button>
            </div>
          )}

          {commentable && (
            <CommentInput
              open={commentInputOpen}
              position={selectionAnchor
                ? {
                    left: selectionAnchor.popoverLeft,
                    top: selectionAnchor.popoverTop,
                  }
                : null}
              mode={composerMode}
              selectedText={selectedText}
              onModeChange={setComposerMode}
              onSubmitComment={handleCreateComment}
              onSubmitSuggestion={handleCreateSuggestion}
              onCancel={() => setCommentInputOpen(false)}
            />
          )}

          {comments.length > 0 && !panelOpen && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="absolute right-3 top-3 z-20 rounded border border-border bg-bg px-2.5 py-1 font-mono text-[11px] text-fg-secondary shadow-sm hover:bg-bg-subtle"
            >
              Comments ({regularCommentCount}
              {suggestionCount > 0 ? ` · ${suggestionCount} suggestions` : ''})
            </button>
          )}
        </div>

        <CommentPanel
          comments={comments}
          activeCommentId={activeCommentId}
          onSelectComment={(commentId) => {
            setPanelOpen(true)
            setActiveCommentId(commentId)
          }}
          onReply={handleReply}
          onResolve={handleResolve}
          onAcceptSuggestion={handleAcceptSuggestion}
          onDismissSuggestion={handleDismissSuggestion}
          canReply={commentable}
          canResolve={canResolve}
          canEdit={editable}
          open={panelOpen && comments.length > 0}
          onToggleOpen={() => setPanelOpen(false)}
        />
      </div>
    </div>
  )
}
