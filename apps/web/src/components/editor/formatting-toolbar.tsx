'use client'

import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { EditorView } from '@codemirror/view'
import {
  toggleBold,
  toggleItalic,
  toggleCode,
  toggleStrikethrough,
  setHeading,
  toggleBulletList,
  toggleNumberedList,
  toggleCheckboxList,
  insertLink,
  insertImage,
  insertCodeBlock,
  insertHorizontalRule,
  insertTable,
} from './formatting-commands'
import type { EditorMode } from './editor-mode'

interface ToolbarButtonProps {
  label: string
  title: string
  ariaLabel: string
  onClick: () => void
  tabIndex: number
  onFocus: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  buttonRef: (el: HTMLButtonElement | null) => void
  shortcut?: string
  className?: string
}

function ToolbarButton({
  label,
  title,
  ariaLabel,
  onClick,
  tabIndex,
  onFocus,
  onKeyDown,
  buttonRef,
  shortcut,
  className,
}: ToolbarButtonProps) {
  const fullTitle = shortcut ? `${title} (${shortcut})` : title
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      title={fullTitle}
      aria-label={ariaLabel}
      className={className ?? 'flex w-[30px] h-[28px] items-center justify-center rounded-sm font-mono text-[13px] text-fg-secondary hover:bg-bg-subtle hover:text-fg active:bg-bg-active'}
    >
      {label}
    </button>
  )
}

function Separator() {
  return <div className="w-px h-[18px] bg-border mx-[6px]" />
}

interface FormattingToolbarProps {
  view: EditorView | null
  previewMode: boolean
  onTogglePreview: () => void
  editorMode: EditorMode
  onModeChange: (mode: EditorMode) => void
  availableModes: EditorMode[]
}

const modeLabels: Record<EditorMode, string> = {
  editing: 'Editing',
  suggesting: 'Suggesting',
  viewing: 'Viewing',
}

export default function FormattingToolbar({
  view,
  previewMode,
  onTogglePreview,
  editorMode,
  onModeChange,
  availableModes,
}: FormattingToolbarProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const modeButtonCount = availableModes.length
  const buttonCount = 15 + modeButtonCount + 1

  const focusButton = useCallback((index: number) => {
    const normalized = (index + buttonCount) % buttonCount
    setActiveIndex(normalized)
    buttonRefs.current[normalized]?.focus()
  }, [buttonCount])

  const handleButtonKeyDown = useCallback((index: number, e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusButton(index + 1)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusButton(index - 1)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusButton(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusButton(buttonCount - 1)
    }
  }, [focusButton, buttonCount])

  const run = useCallback(
    (fn: (view: EditorView) => void) => {
      if (view) fn(view)
    },
    [view],
  )

  return (
    <div className="border-b border-border bg-bg px-5 py-2 flex items-center gap-[2px]" role="toolbar" aria-label="formatting toolbar">
      <ToolbarButton
        label="H1"
        title="Heading 1"
        ariaLabel="heading 1"
        onClick={() => run((v) => setHeading(v, 1))}
        tabIndex={activeIndex === 0 ? 0 : -1}
        onFocus={() => setActiveIndex(0)}
        onKeyDown={(e) => handleButtonKeyDown(0, e)}
        buttonRef={(el) => {
          buttonRefs.current[0] = el
        }}
      />
      <ToolbarButton
        label="H2"
        title="Heading 2"
        ariaLabel="heading 2"
        onClick={() => run((v) => setHeading(v, 2))}
        tabIndex={activeIndex === 1 ? 0 : -1}
        onFocus={() => setActiveIndex(1)}
        onKeyDown={(e) => handleButtonKeyDown(1, e)}
        buttonRef={(el) => {
          buttonRefs.current[1] = el
        }}
      />
      <ToolbarButton
        label="H3"
        title="Heading 3"
        ariaLabel="heading 3"
        onClick={() => run((v) => setHeading(v, 3))}
        tabIndex={activeIndex === 2 ? 0 : -1}
        onFocus={() => setActiveIndex(2)}
        onKeyDown={(e) => handleButtonKeyDown(2, e)}
        buttonRef={(el) => {
          buttonRefs.current[2] = el
        }}
      />
      <Separator />

      <ToolbarButton
        label="B"
        title="Bold"
        ariaLabel="bold"
        shortcut="⌘B"
        onClick={() => run(toggleBold)}
        tabIndex={activeIndex === 3 ? 0 : -1}
        onFocus={() => setActiveIndex(3)}
        onKeyDown={(e) => handleButtonKeyDown(3, e)}
        buttonRef={(el) => {
          buttonRefs.current[3] = el
        }}
      />
      <ToolbarButton
        label="I"
        title="Italic"
        ariaLabel="italic"
        shortcut="⌘I"
        onClick={() => run(toggleItalic)}
        tabIndex={activeIndex === 4 ? 0 : -1}
        onFocus={() => setActiveIndex(4)}
        onKeyDown={(e) => handleButtonKeyDown(4, e)}
        buttonRef={(el) => {
          buttonRefs.current[4] = el
        }}
      />
      <ToolbarButton
        label="S"
        title="Strikethrough"
        ariaLabel="strikethrough"
        shortcut="⌘⇧X"
        onClick={() => run(toggleStrikethrough)}
        tabIndex={activeIndex === 5 ? 0 : -1}
        onFocus={() => setActiveIndex(5)}
        onKeyDown={(e) => handleButtonKeyDown(5, e)}
        buttonRef={(el) => {
          buttonRefs.current[5] = el
        }}
      />
      <ToolbarButton
        label="<>"
        title="Inline code"
        ariaLabel="inline code"
        shortcut="⌘E"
        onClick={() => run(toggleCode)}
        tabIndex={activeIndex === 6 ? 0 : -1}
        onFocus={() => setActiveIndex(6)}
        onKeyDown={(e) => handleButtonKeyDown(6, e)}
        buttonRef={(el) => {
          buttonRefs.current[6] = el
        }}
      />
      <Separator />

      <ToolbarButton
        label="•"
        title="Bullet list"
        ariaLabel="bullet list"
        onClick={() => run(toggleBulletList)}
        tabIndex={activeIndex === 7 ? 0 : -1}
        onFocus={() => setActiveIndex(7)}
        onKeyDown={(e) => handleButtonKeyDown(7, e)}
        buttonRef={(el) => {
          buttonRefs.current[7] = el
        }}
      />
      <ToolbarButton
        label="1."
        title="Numbered list"
        ariaLabel="numbered list"
        onClick={() => run(toggleNumberedList)}
        tabIndex={activeIndex === 8 ? 0 : -1}
        onFocus={() => setActiveIndex(8)}
        onKeyDown={(e) => handleButtonKeyDown(8, e)}
        buttonRef={(el) => {
          buttonRefs.current[8] = el
        }}
      />
      <ToolbarButton
        label="☐"
        title="Checkbox list"
        ariaLabel="checkbox list"
        onClick={() => run(toggleCheckboxList)}
        tabIndex={activeIndex === 9 ? 0 : -1}
        onFocus={() => setActiveIndex(9)}
        onKeyDown={(e) => handleButtonKeyDown(9, e)}
        buttonRef={(el) => {
          buttonRefs.current[9] = el
        }}
      />
      <Separator />

      <ToolbarButton
        label="🔗"
        title="Link"
        ariaLabel="insert link"
        shortcut="⌘⇧K"
        onClick={() => run(insertLink)}
        tabIndex={activeIndex === 10 ? 0 : -1}
        onFocus={() => setActiveIndex(10)}
        onKeyDown={(e) => handleButtonKeyDown(10, e)}
        buttonRef={(el) => {
          buttonRefs.current[10] = el
        }}
      />
      <ToolbarButton
        label="🖼"
        title="Image"
        ariaLabel="insert image"
        onClick={() => run(insertImage)}
        tabIndex={activeIndex === 11 ? 0 : -1}
        onFocus={() => setActiveIndex(11)}
        onKeyDown={(e) => handleButtonKeyDown(11, e)}
        buttonRef={(el) => {
          buttonRefs.current[11] = el
        }}
      />
      <ToolbarButton
        label="```"
        title="Code block"
        ariaLabel="insert code block"
        onClick={() => run(insertCodeBlock)}
        tabIndex={activeIndex === 12 ? 0 : -1}
        onFocus={() => setActiveIndex(12)}
        onKeyDown={(e) => handleButtonKeyDown(12, e)}
        buttonRef={(el) => {
          buttonRefs.current[12] = el
        }}
      />
      <ToolbarButton
        label="⊞"
        title="Table"
        ariaLabel="insert table"
        onClick={() => run(insertTable)}
        tabIndex={activeIndex === 13 ? 0 : -1}
        onFocus={() => setActiveIndex(13)}
        onKeyDown={(e) => handleButtonKeyDown(13, e)}
        buttonRef={(el) => {
          buttonRefs.current[13] = el
        }}
      />
      <ToolbarButton
        label="—"
        title="Horizontal rule"
        ariaLabel="insert horizontal rule"
        onClick={() => run(insertHorizontalRule)}
        tabIndex={activeIndex === 14 ? 0 : -1}
        onFocus={() => setActiveIndex(14)}
        onKeyDown={(e) => handleButtonKeyDown(14, e)}
        buttonRef={(el) => {
          buttonRefs.current[14] = el
        }}
      />

      <div className="flex-1" />

      <div className="flex items-center gap-0 rounded border border-border bg-bg-subtle p-0.5" role="radiogroup" aria-label="editor mode">
        {availableModes.map((mode, i) => {
          const idx = 15 + i
          const isActive = mode === editorMode
          return (
            <button
              key={mode}
              ref={(el) => {
                buttonRefs.current[idx] = el
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onModeChange(mode)}
              onFocus={() => setActiveIndex(idx)}
              onKeyDown={(e) => handleButtonKeyDown(idx, e)}
              tabIndex={activeIndex === idx ? 0 : -1}
              className={`rounded px-2 py-1 font-mono text-[11px] ${
                isActive
                  ? 'bg-fg text-bg'
                  : 'text-fg-secondary hover:bg-bg-subtle'
              }`}
            >
              {modeLabels[mode]}
            </button>
          )
        })}
      </div>

      <ToolbarButton
        label={previewMode ? 'Preview' : 'Source'}
        title={previewMode ? 'Switch to source mode' : 'Switch to live preview'}
        ariaLabel={previewMode ? 'switch to source mode' : 'switch to live preview'}
        onClick={onTogglePreview}
        tabIndex={activeIndex === 15 + modeButtonCount ? 0 : -1}
        onFocus={() => setActiveIndex(15 + modeButtonCount)}
        onKeyDown={(e) => handleButtonKeyDown(15 + modeButtonCount, e)}
        buttonRef={(el) => {
          buttonRefs.current[15 + modeButtonCount] = el
        }}
        className={`flex h-[28px] items-center gap-1 px-2 font-mono text-[13px] ${
          previewMode
            ? 'bg-fg text-bg rounded-sm'
            : 'text-fg-secondary hover:bg-bg-subtle rounded-sm'
        }`}
      />
    </div>
  )
}
