'use client'

import { useEffect, useState } from 'react'
import {
  defaultEditorAppearanceId,
  editorAppearances,
  EDITOR_APPEARANCE_EVENT,
  EDITOR_APPEARANCE_STORAGE_KEY,
  isEditorAppearanceId,
  type EditorAppearanceId,
} from './editor-appearance'

export function EditorThemeSelect() {
  const [appearanceId, setAppearanceId] = useState<EditorAppearanceId>(defaultEditorAppearanceId)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(EDITOR_APPEARANCE_STORAGE_KEY)
    if (stored && isEditorAppearanceId(stored)) {
      setAppearanceId(stored)
    }
  }, [])

  const updateAppearance = (next: EditorAppearanceId) => {
    setAppearanceId(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EDITOR_APPEARANCE_STORAGE_KEY, next)
      window.dispatchEvent(
        new CustomEvent(EDITOR_APPEARANCE_EVENT, { detail: { appearanceId: next } }),
      )
    }
  }

  return (
    <label className="inline-flex items-center gap-2 rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg-secondary">
      <span className="hidden sm:inline">Theme</span>
      <select
        value={appearanceId}
        onChange={(event) => updateAppearance(event.target.value as EditorAppearanceId)}
        className="bg-transparent text-fg outline-none"
        aria-label="Editor theme"
      >
        {editorAppearances.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.label}
          </option>
        ))}
      </select>
    </label>
  )
}
