'use client'

import { useEffect } from 'react'
import {
  defaultEditorAppearanceId,
  EDITOR_APPEARANCE_EVENT,
  EDITOR_APPEARANCE_STORAGE_KEY,
  isEditorAppearanceId,
  type EditorAppearanceId,
} from '@/components/editor/editor-appearance'

function applyTheme(appearanceId: EditorAppearanceId) {
  document.documentElement.dataset.appTheme = appearanceId
}

export function AppThemeBridge() {
  useEffect(() => {
    const stored = window.localStorage.getItem(EDITOR_APPEARANCE_STORAGE_KEY)
    const initial = stored && isEditorAppearanceId(stored) ? stored : defaultEditorAppearanceId
    applyTheme(initial)

    const handleAppearanceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ appearanceId?: string }>).detail
      const next = detail?.appearanceId
      if (next && isEditorAppearanceId(next)) {
        applyTheme(next)
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== EDITOR_APPEARANCE_STORAGE_KEY) return
      const next = event.newValue
      if (next && isEditorAppearanceId(next)) applyTheme(next)
      else applyTheme(defaultEditorAppearanceId)
    }

    window.addEventListener(EDITOR_APPEARANCE_EVENT, handleAppearanceChange)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(EDITOR_APPEARANCE_EVENT, handleAppearanceChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return null
}
