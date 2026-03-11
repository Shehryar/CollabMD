// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownPreviewPlugin, markdownPreviewTheme, previewEnabled } from './markdown-preview'

interface KatexRenderOptions {
  displayMode?: boolean
  throwOnError?: boolean
}

interface MermaidInitializeOptions {
  startOnLoad?: boolean
  securityLevel?: string
  suppressErrorRendering?: boolean
  theme?: string
  fontFamily?: string
}

let view: EditorView | null = null

function createView(doc: string, anchor?: number): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)

  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: anchor === undefined ? undefined : { anchor },
      extensions: [markdown({ base: markdownLanguage }), previewEnabled, markdownPreviewPlugin, markdownPreviewTheme],
    }),
    parent,
  })

  return view
}

function getLineTexts(): string[] {
  return Array.from(view?.dom.querySelectorAll('.cm-line') ?? []).map((line) => line.textContent ?? '')
}

beforeEach(() => {
  window.katex = {
    render: vi.fn((expression: string, element: HTMLElement, options?: KatexRenderOptions) => {
      element.textContent = `rendered:${expression}`
      element.setAttribute('data-display-mode', String(options?.displayMode ?? false))
    }),
  }
  window.__collabmdKatexPromise = undefined
  window.mermaid = {
    initialize: vi.fn((_options?: MermaidInitializeOptions) => undefined),
    render: vi.fn(async (_id: string, text: string) => ({
      svg: `<svg data-mermaid-definition="${text.replace(/"/g, '&quot;')}"></svg>`,
    })),
  }
  window.__collabmdMermaidPromise = undefined
  window.__collabmdMermaidInitialized = undefined
})

afterEach(() => {
  view?.dom.parentElement?.remove()
  view?.destroy()
  view = null
  window.katex = undefined
  window.__collabmdKatexPromise = undefined
  window.mermaid = undefined
  window.__collabmdMermaidPromise = undefined
  window.__collabmdMermaidInitialized = undefined
  document.getElementById('collabmd-katex-script')?.remove()
  document.getElementById('collabmd-katex-stylesheet')?.remove()
  document.getElementById('collabmd-mermaid-script')?.remove()
})

describe('markdown preview math rendering', () => {
  it('renders inline LaTeX with KaTeX in preview mode', () => {
    createView('Euler: $e^{i\\\\pi} + 1 = 0$.')

    const math = view?.dom.querySelector<HTMLElement>('.cm-md-math-inline')
    expect(math).not.toBeNull()
    expect(math?.textContent).toBe('rendered:e^{i\\\\pi} + 1 = 0')
    expect(math?.getAttribute('data-display-mode')).toBe('false')
    expect(window.katex?.render).toHaveBeenCalledWith(
      'e^{i\\\\pi} + 1 = 0',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: false, throwOnError: false }),
    )
  })

  it('renders block LaTeX with KaTeX display mode', () => {
    createView(['Before', '', '$$', '\\\\int_0^1 x^2 \\\\, dx', '$$', '', 'After'].join('\n'))

    const math = view?.dom.querySelector<HTMLElement>('.cm-md-math-block')
    expect(math).not.toBeNull()
    expect(math?.textContent).toBe('rendered:\\\\int_0^1 x^2 \\\\, dx')
    expect(math?.getAttribute('data-display-mode')).toBe('true')
    expect(window.katex?.render).toHaveBeenCalledWith(
      '\\\\int_0^1 x^2 \\\\, dx',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: true, throwOnError: false }),
    )
  })

  it('shows raw source while the cursor is inside a math expression', () => {
    createView('Inline math $x^2 + y^2$ stays editable.', 14)

    expect(view?.dom.querySelector('.cm-md-math-inline')).toBeNull()
    expect(view?.dom.textContent).toContain('$x^2 + y^2$')
    expect(window.katex?.render).not.toHaveBeenCalled()
  })

  it('does not render LaTeX inside inline code spans', () => {
    createView('`$x$` but $y$ should render.')

    expect(view?.dom.querySelectorAll('.cm-md-math-inline').length).toBe(1)
    expect(window.katex?.render).toHaveBeenCalledTimes(1)
    expect(window.katex?.render).toHaveBeenCalledWith(
      'y',
      expect.any(HTMLElement),
      expect.objectContaining({ displayMode: false }),
    )
  })
})

describe('markdown preview mermaid rendering', () => {
  it('renders mermaid fenced code blocks as diagrams in preview mode', async () => {
    const doc = ['```mermaid', 'graph TD', '  A[Start] --> B[Finish]', '```', '', 'After'].join('\n')
    createView(doc, doc.length)

    await vi.waitFor(() => {
      const svg = view?.dom.querySelector<SVGElement>('.cm-md-mermaid svg')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('data-mermaid-definition')).toBe('graph TD\n  A[Start] --> B[Finish]')
    })

    expect(window.mermaid?.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'neutral',
      }),
    )
    expect(window.mermaid?.render).toHaveBeenCalledWith(
      expect.stringMatching(/^collabmd-mermaid-\d+$/),
      'graph TD\n  A[Start] --> B[Finish]',
    )
  })

  it('shows raw mermaid source while the cursor is inside the fenced block', () => {
    createView(['Before', '```mermaid', 'graph TD', '  A --> B', '```', 'After'].join('\n'), 12)

    expect(view?.dom.querySelector('.cm-md-mermaid')).toBeNull()
    expect(view?.dom.textContent).toContain('```mermaid')
    expect(window.mermaid?.render).not.toHaveBeenCalled()
  })
})

describe('markdown preview list rendering', () => {
  it('renders bullet list items with a single bullet marker', () => {
    const doc = '- Item one\n- Item two\n\n'
    createView(doc, doc.length)

    const bullets = view?.dom.querySelectorAll('.cm-md-bullet')
    const lineTexts = getLineTexts()

    expect(bullets).toHaveLength(2)
    expect(lineTexts[0]).toBe('•Item one')
    expect(lineTexts[1]).toBe('•Item two')
  })

  it('renders ordered list items with a single number marker', () => {
    const doc = '1. First step\n2. Second step\n\n'
    createView(doc, doc.length)

    const numbers = Array.from(view?.dom.querySelectorAll('.cm-md-list-number') ?? []).map(
      (node) => node.textContent,
    )
    const lineTexts = getLineTexts()

    expect(numbers).toEqual(['1.', '2.'])
    expect(lineTexts[0]).toBe('1.First step')
    expect(lineTexts[1]).toBe('2.Second step')
  })

  it('renders task lists as interactive checkboxes and toggles the markdown marker', () => {
    const doc = '- [ ] Todo\n- [x] Done\n\n'
    createView(doc, doc.length)

    const checkboxes = Array.from(
      view?.dom.querySelectorAll<HTMLInputElement>('input.cm-md-checkbox[type="checkbox"]') ?? [],
    )

    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]?.checked).toBe(false)
    expect(checkboxes[1]?.checked).toBe(true)

    checkboxes[0]?.click()

    expect(view?.state.doc.toString()).toContain('- [x] Todo')
  })

  it('does not bleed ordered numbering into a following checkbox block', () => {
    const doc = '1. First\n2. Second\n- [ ] Todo\n- [x] Done\n\n'
    createView(doc, doc.length)

    const numbers = Array.from(view?.dom.querySelectorAll('.cm-md-list-number') ?? []).map(
      (node) => node.textContent,
    )
    const checkboxes = view?.dom.querySelectorAll('input.cm-md-checkbox[type="checkbox"]')
    const lineTexts = getLineTexts()

    expect(numbers).toEqual(['1.', '2.'])
    expect(checkboxes).toHaveLength(2)
    expect(lineTexts[2]).toBe('Todo')
    expect(lineTexts[3]).toBe('Done')
  })
})

describe('markdown preview highlight rendering', () => {
  it('renders ==text== as highlighted text when the cursor is on another line', () => {
    const doc = 'This is ==important== text.\nNext line'
    createView(doc, doc.length)

    const highlight = view?.dom.querySelector<HTMLElement>('.cm-md-highlight')
    const lineTexts = getLineTexts()

    expect(highlight).not.toBeNull()
    expect(highlight?.textContent).toBe('important')
    expect(lineTexts[0]).toBe('This is important text.')
  })

  it('shows raw == markers while editing on the same line', () => {
    createView('This is ==important== text.', 10)

    expect(view?.dom.querySelector('.cm-md-highlight')).not.toBeNull()
    expect(getLineTexts()[0]).toContain('==important==')
  })
})
