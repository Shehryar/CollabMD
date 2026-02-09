'use client'

import { useCallback } from 'react'
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

interface ToolbarButtonProps {
  label: string
  title: string
  onClick: () => void
  shortcut?: string
}

function ToolbarButton({ label, title, onClick, shortcut }: ToolbarButtonProps) {
  const fullTitle = shortcut ? `${title} (${shortcut})` : title
  return (
    <button
      type="button"
      onClick={onClick}
      title={fullTitle}
      className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200"
    >
      {label}
    </button>
  )
}

function Separator() {
  return <div className="mx-0.5 h-4 w-px bg-gray-200" />
}

interface FormattingToolbarProps {
  view: EditorView | null
  previewMode: boolean
  onTogglePreview: () => void
}

export default function FormattingToolbar({
  view,
  previewMode,
  onTogglePreview,
}: FormattingToolbarProps) {
  const run = useCallback(
    (fn: (view: EditorView) => void) => {
      if (view) fn(view)
    },
    [view]
  )

  return (
    <div className="flex items-center gap-0.5 border-b border-gray-200 bg-white px-2 py-1">
      {/* Headings */}
      <ToolbarButton
        label="H1"
        title="Heading 1"
        onClick={() => run((v) => setHeading(v, 1))}
      />
      <ToolbarButton
        label="H2"
        title="Heading 2"
        onClick={() => run((v) => setHeading(v, 2))}
      />
      <ToolbarButton
        label="H3"
        title="Heading 3"
        onClick={() => run((v) => setHeading(v, 3))}
      />
      <Separator />

      {/* Inline formatting */}
      <ToolbarButton
        label="B"
        title="Bold"
        shortcut="⌘B"
        onClick={() => run(toggleBold)}
      />
      <ToolbarButton
        label="I"
        title="Italic"
        shortcut="⌘I"
        onClick={() => run(toggleItalic)}
      />
      <ToolbarButton
        label="S"
        title="Strikethrough"
        shortcut="⌘⇧X"
        onClick={() => run(toggleStrikethrough)}
      />
      <ToolbarButton
        label="<>"
        title="Inline code"
        shortcut="⌘E"
        onClick={() => run(toggleCode)}
      />
      <Separator />

      {/* Lists */}
      <ToolbarButton
        label="•"
        title="Bullet list"
        onClick={() => run(toggleBulletList)}
      />
      <ToolbarButton
        label="1."
        title="Numbered list"
        onClick={() => run(toggleNumberedList)}
      />
      <ToolbarButton
        label="☐"
        title="Checkbox list"
        onClick={() => run(toggleCheckboxList)}
      />
      <Separator />

      {/* Insert */}
      <ToolbarButton
        label="🔗"
        title="Link"
        shortcut="⌘⇧K"
        onClick={() => run(insertLink)}
      />
      <ToolbarButton
        label="🖼"
        title="Image"
        onClick={() => run(insertImage)}
      />
      <ToolbarButton
        label="```"
        title="Code block"
        onClick={() => run(insertCodeBlock)}
      />
      <ToolbarButton
        label="⊞"
        title="Table"
        onClick={() => run(insertTable)}
      />
      <ToolbarButton
        label="—"
        title="Horizontal rule"
        onClick={() => run(insertHorizontalRule)}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Preview toggle */}
      <button
        type="button"
        onClick={onTogglePreview}
        title={previewMode ? 'Switch to source mode' : 'Switch to live preview'}
        className={`flex h-7 items-center gap-1 rounded px-2 text-xs ${
          previewMode
            ? 'bg-gray-900 text-white'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        {previewMode ? 'Preview' : 'Source'}
      </button>
    </div>
  )
}
