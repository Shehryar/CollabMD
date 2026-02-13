'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'

type CommentInputMode = 'comment' | 'suggest'

interface CommentInputProps {
  open: boolean
  position: { left: number; top: number } | null
  mode: CommentInputMode
  selectedText: string
  onModeChange: (mode: CommentInputMode) => void
  onSubmitComment: (text: string) => void
  onSubmitSuggestion: (proposedText: string) => void
  onCancel: () => void
}

export default function CommentInput({
  open,
  position,
  mode,
  selectedText,
  onModeChange,
  onSubmitComment,
  onSubmitSuggestion,
  onCancel,
}: CommentInputProps) {
  const [text, setText] = useState('')
  const [proposedText, setProposedText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const proposedRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setText('')
      setProposedText('')
      return
    }

    const frame = requestAnimationFrame(() => {
      if (mode === 'suggest') {
        proposedRef.current?.focus()
        return
      }
      textareaRef.current?.focus()
    })

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      onCancel()
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onEscape)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [mode, open, onCancel])

  if (!open || !position) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'suggest') {
      onSubmitSuggestion(proposedText)
      setProposedText('')
      return
    }

    const body = text.trim()
    if (!body) return
    onSubmitComment(body)
    setText('')
  }

  return (
    <div
      ref={rootRef}
      className="fixed z-40 w-72 rounded-lg border border-border bg-bg p-3 shadow-default"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
      role="dialog"
      aria-label={mode === 'suggest' ? 'Suggest inline edit' : 'Add inline comment'}
    >
      <form onSubmit={submit} className="space-y-2">
        <div className="flex items-center gap-1 rounded border border-border bg-bg-subtle p-1">
          <button
            type="button"
            onClick={() => onModeChange('comment')}
            className={`flex-1 rounded px-2 py-1 font-mono text-[11px] ${
              mode === 'comment'
                ? 'bg-bg text-fg shadow-sm'
                : 'text-fg-secondary hover:bg-bg'
            }`}
          >
            Comment
          </button>
          <button
            type="button"
            onClick={() => onModeChange('suggest')}
            className={`flex-1 rounded px-2 py-1 font-mono text-[11px] ${
              mode === 'suggest'
                ? 'bg-bg text-fg shadow-sm'
                : 'text-fg-secondary hover:bg-bg'
            }`}
          >
            Suggest
          </button>
        </div>

        {mode === 'suggest' ? (
          <div className="space-y-2">
            <div className="rounded border border-red/20 bg-red-subtle px-2.5 py-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-red">Original</p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-red line-through">{selectedText}</p>
            </div>
            <textarea
              ref={proposedRef}
              rows={4}
              value={proposedText}
              onChange={(event) => setProposedText(event.target.value)}
              placeholder="Proposed replacement text"
              className="w-full resize-none rounded border border-border bg-bg px-2.5 py-2 font-sans text-[13px] text-fg outline-none focus:border-accent"
            />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Add a comment"
            className="w-full resize-none rounded border border-border bg-bg px-2.5 py-2 font-sans text-[13px] text-fg outline-none focus:border-accent"
          />
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-2.5 py-1 font-mono text-[11px] text-fg-secondary hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mode === 'comment' && text.trim().length === 0}
            className="rounded border border-accent bg-accent px-2.5 py-1 font-mono text-[11px] text-accent-text disabled:cursor-not-allowed disabled:opacity-55"
          >
            {mode === 'suggest' ? 'Create suggestion' : 'Add comment'}
          </button>
        </div>
      </form>
    </div>
  )
}
