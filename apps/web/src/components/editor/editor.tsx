'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, rectangularSelection, highlightActiveLineGutter, placeholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { yCollab } from 'y-codemirror.next'
import type { YjsContext } from './use-yjs'
import {
  markdownPreviewPlugin,
  markdownPreviewTheme,
  previewEnabled,
  togglePreviewEffect,
} from './markdown-preview'
import { formattingKeymap } from './formatting-commands'
import FormattingToolbar from './formatting-toolbar'

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
  },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '16px 0',
    maxWidth: '72ch',
    margin: '0 auto',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: '#6b7280',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#d1d5db',
  },
  '.cm-activeLine': {
    backgroundColor: '#f9fafb',
  },
  '.cm-cursor': {
    borderLeftColor: '#111827',
    borderLeftWidth: '2px',
  },
  // Yjs remote cursors
  '.cm-ySelectionInfo': {
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    padding: '1px 4px',
    borderRadius: '3px 3px 3px 0',
    opacity: '1',
  },
})

interface CollabEditorProps {
  yjs: YjsContext
}

export default function CollabEditor({ yjs }: CollabEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [view, setView] = useState<EditorView | null>(null)
  const [previewMode, setPreviewMode] = useState(true)

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
        editorTheme,
        // Live preview decorations
        previewEnabled,
        markdownPreviewPlugin,
        markdownPreviewTheme,
        placeholder('Start writing markdown...'),
        // Yjs collab binding — must come after history() so undo is collab-aware
        yCollab(yjs.ytext, yjs.awareness),
      ],
    })

    const editorView = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = editorView
    setView(editorView)

    return () => {
      editorView.destroy()
      viewRef.current = null
      setView(null)
    }
  }, [yjs])

  const handleTogglePreview = useCallback(() => {
    const v = viewRef.current
    if (!v) return
    const next = !previewMode
    setPreviewMode(next)
    v.dispatch({ effects: togglePreviewEffect.of(next) })
  }, [previewMode])

  return (
    <div className="flex h-full flex-col">
      <FormattingToolbar
        view={view}
        previewMode={previewMode}
        onTogglePreview={handleTogglePreview}
      />
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
      />
    </div>
  )
}
