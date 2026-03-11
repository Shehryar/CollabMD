// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import CollabEditor from './editor'
import type { YjsContext } from './use-yjs'

function createTestYjsContext(doc: string): YjsContext {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('codemirror')
  ytext.insert(0, doc)

  return {
    ydoc,
    ytext,
    ycomments: ydoc.getArray<Y.Map<unknown>>('comments'),
    ydiscussions: ydoc.getArray<Y.Map<unknown>>('discussions'),
    awareness: new Awareness(ydoc),
    synced: true,
    connectionStatus: 'connected',
    syncUrl: 'ws://localhost:4444',
  }
}

describe('CollabEditor source mode', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let yjs: YjsContext | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {}
    }
    if (!globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 0)
    }
    if (!globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame = (handle: number) => {
        window.clearTimeout(handle)
      }
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    yjs = createTestYjsContext(['Intro', '# Heading', '', 'Body copy'].join('\n'))
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    yjs?.awareness.destroy()
    yjs?.ydoc.destroy()
    container?.remove()
    root = null
    container = null
    yjs = null
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  async function renderEditor() {
    if (!yjs) {
      throw new Error('yjs context not initialized')
    }
    const context = yjs
    await act(async () => {
      root?.render(createElement(CollabEditor, { yjs: context, canEdit: true }))
    })
  }

  function requireButton(text: string): HTMLButtonElement {
    const button = Array.from(container?.querySelectorAll('button') ?? []).find(
      (entry) => entry.textContent?.trim() === text,
    )
    if (!button) throw new Error(`button "${text}" not found`)
    return button as HTMLButtonElement
  }

  async function clickButton(text: string) {
    const button = requireButton(text)
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('labels the raw markdown toggle as Source and exits source mode on editor mode changes', async () => {
    await renderEditor()

    const sourceButton = requireButton('Source')
    expect(sourceButton.title).toBe('Switch to source mode')
    expect(container?.querySelector('.cm-md-h1')).not.toBeNull()
    expect(container?.querySelector('.cm-content')?.textContent).not.toContain('# Heading')

    await clickButton('Source')

    expect(container?.querySelector('.cm-md-h1')).toBeNull()
    expect(container?.querySelector('.cm-content')?.textContent).toContain('# Heading')

    await clickButton('Viewing')

    expect(container?.querySelector('.cm-md-h1')).not.toBeNull()
    expect(container?.querySelector('.cm-content')?.textContent).not.toContain('# Heading')
  })
})
