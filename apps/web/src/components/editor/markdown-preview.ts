import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { EditorState, Range, StateEffect, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

interface KatexRenderer {
  render: (
    expression: string,
    element: HTMLElement,
    options?: {
      displayMode?: boolean
      throwOnError?: boolean
    },
  ) => void
}

interface MermaidRenderResult {
  svg: string
  bindFunctions?: (element: Element) => void
}

interface MermaidRenderer {
  initialize: (config: {
    startOnLoad?: boolean
    securityLevel?: 'strict' | 'loose' | 'antiscript' | 'sandbox'
    suppressErrorRendering?: boolean
    theme?: string
    fontFamily?: string
  }) => void
  render: (id: string, text: string) => Promise<MermaidRenderResult>
}

interface MathRange {
  from: number
  to: number
  expression: string
  displayMode: boolean
}

interface MermaidBlockRange {
  from: number
  to: number
  firstLineFrom: number
  firstLineTo: number
  lastLineNumber: number
  definition: string
}

interface PreviewIgnoredRange {
  from: number
  to: number
}

interface HighlightRange {
  from: number
  to: number
}

interface ListPrefixMatch {
  kind: 'bullet' | 'ordered' | 'checkbox'
  replaceTo: number
  markerText?: string
  checked?: boolean
  checkboxFrom?: number
  checkboxTo?: number
}

declare global {
  interface Window {
    katex?: KatexRenderer
    __collabmdKatexPromise?: Promise<KatexRenderer | null>
    mermaid?: MermaidRenderer
    __collabmdMermaidPromise?: Promise<MermaidRenderer | null>
    __collabmdMermaidInitialized?: boolean
  }
}

const KATEX_VERSION = '0.16.11'
const KATEX_SCRIPT_ID = 'collabmd-katex-script'
const KATEX_STYLESHEET_ID = 'collabmd-katex-stylesheet'
const KATEX_SCRIPT_SRC = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`
const KATEX_STYLESHEET_HREF = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`
const MERMAID_VERSION = '11.13.0'
const MERMAID_SCRIPT_ID = 'collabmd-mermaid-script'
const MERMAID_MODULE_SRC = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.esm.min.mjs`

let mermaidGraphCounter = 0

// --- Toggle state ---

export const togglePreviewEffect = StateEffect.define<boolean>()

export const previewEnabled = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(togglePreviewEffect)) return e.value
    }
    return value
  },
})

// --- Link widget ---

class LinkWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly url: string,
  ) {
    super()
  }

  toDOM() {
    const a = document.createElement('a')
    a.textContent = this.text
    a.href = this.url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.className = 'cm-md-link'
    a.addEventListener('click', (e) => {
      e.preventDefault()
      window.open(this.url, '_blank', 'noopener,noreferrer')
    })
    return a
  }

  eq(other: LinkWidget) {
    return this.text === other.text && this.url === other.url
  }

  ignoreEvent() {
    return false
  }
}

function isSafeLink(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  return !(
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  )
}

function ensureKatexStylesheet() {
  if (typeof document === 'undefined') return
  if (document.getElementById(KATEX_STYLESHEET_ID)) return

  const link = document.createElement('link')
  link.id = KATEX_STYLESHEET_ID
  link.rel = 'stylesheet'
  link.href = KATEX_STYLESHEET_HREF
  document.head.append(link)
}

function ensureKatexLoaded(): Promise<KatexRenderer | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null)
  }

  if (window.katex) {
    ensureKatexStylesheet()
    return Promise.resolve(window.katex)
  }

  ensureKatexStylesheet()

  if (window.__collabmdKatexPromise) {
    return window.__collabmdKatexPromise
  }

  window.__collabmdKatexPromise = new Promise((resolve) => {
    const existingScript = document.getElementById(KATEX_SCRIPT_ID) as HTMLScriptElement | null
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.katex ?? null), { once: true })
      existingScript.addEventListener('error', () => resolve(null), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = KATEX_SCRIPT_ID
    script.src = KATEX_SCRIPT_SRC
    script.async = true
    script.addEventListener('load', () => resolve(window.katex ?? null), { once: true })
    script.addEventListener('error', () => resolve(null), { once: true })
    document.head.append(script)
  })

  return window.__collabmdKatexPromise
}

function initializeMermaid(renderer: MermaidRenderer | null): MermaidRenderer | null {
  if (!renderer) return null
  if (!window.__collabmdMermaidInitialized) {
    renderer.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'neutral',
      fontFamily: 'var(--font-sans), "Plus Jakarta Sans", system-ui, sans-serif',
    })
    window.__collabmdMermaidInitialized = true
  }
  return renderer
}

function ensureMermaidLoaded(): Promise<MermaidRenderer | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null)
  }

  if (window.mermaid) {
    return Promise.resolve(initializeMermaid(window.mermaid))
  }

  if (window.__collabmdMermaidPromise) {
    return window.__collabmdMermaidPromise
  }

  window.__collabmdMermaidPromise = new Promise((resolve) => {
    const existingScript = document.getElementById(MERMAID_SCRIPT_ID) as HTMLScriptElement | null
    if (existingScript) {
      existingScript.addEventListener(
        'load',
        () => resolve(initializeMermaid(window.mermaid ?? null)),
        { once: true },
      )
      existingScript.addEventListener('error', () => resolve(null), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = MERMAID_SCRIPT_ID
    script.type = 'module'
    script.textContent = `import mermaid from '${MERMAID_MODULE_SRC}'; window.mermaid = mermaid;`
    script.addEventListener('load', () => resolve(initializeMermaid(window.mermaid ?? null)), {
      once: true,
    })
    script.addEventListener('error', () => resolve(null), { once: true })
    document.head.append(script)
  })

  return window.__collabmdMermaidPromise
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    backslashes++
  }
  return backslashes % 2 === 1
}

function normalizeMathExpression(expression: string): string {
  return expression.trim()
}

function isStandaloneMathDelimiter(
  text: string,
  delimiterFrom: number,
  delimiterTo: number,
): boolean {
  const lineStart = text.lastIndexOf('\n', delimiterFrom - 1) + 1
  const nextLineBreak = text.indexOf('\n', delimiterTo)
  const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak
  return (
    text.slice(lineStart, delimiterFrom).trim().length === 0 &&
    text.slice(delimiterTo, lineEnd).trim().length === 0
  )
}

function skipIgnoredRange(
  position: number,
  ignoredRanges: PreviewIgnoredRange[],
  startIndex: number,
): { position: number; index: number } {
  let index = startIndex
  while (index < ignoredRanges.length && position >= ignoredRanges[index].to) {
    index++
  }

  if (index < ignoredRanges.length && position >= ignoredRanges[index].from) {
    return {
      position: ignoredRanges[index].to,
      index,
    }
  }

  return { position, index }
}

function collectIgnoredRanges(state: EditorState): PreviewIgnoredRange[] {
  const ignoredRanges: PreviewIgnoredRange[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') {
        ignoredRanges.push({ from: node.from, to: node.to })
        return false
      }
      return undefined
    },
  })

  return ignoredRanges
}

function findClosingHighlight(
  text: string,
  from: number,
  to: number,
  ignoredRanges: PreviewIgnoredRange[],
  ignoredIndex: number,
): number | null {
  let index = ignoredIndex

  for (let pos = from; pos < to - 1; pos++) {
    const visible = skipIgnoredRange(pos, ignoredRanges, index)
    pos = visible.position
    index = visible.index
    if (pos >= to - 1) break

    if (text[pos] === '=' && text[pos + 1] === '=' && !isEscaped(text, pos)) {
      return pos
    }
  }

  return null
}

function findHighlightRanges(state: EditorState): HighlightRange[] {
  const text = state.doc.toString()
  const ignoredRanges = collectIgnoredRanges(state)
  const ranges: HighlightRange[] = []
  let ignoredIndex = 0

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Link' || node.name === 'URL') {
        ignoredRanges.push({ from: node.from, to: node.to })
        return false
      }
      return undefined
    },
  })

  for (const range of findMathRanges(state)) {
    ignoredRanges.push({ from: range.from, to: range.to })
  }

  ignoredRanges.sort((a, b) => a.from - b.from)

  for (let pos = 0; pos < text.length - 3; pos++) {
    const visible = skipIgnoredRange(pos, ignoredRanges, ignoredIndex)
    pos = visible.position
    ignoredIndex = visible.index
    if (pos >= text.length - 3) break

    if (text[pos] !== '=' || text[pos + 1] !== '=' || isEscaped(text, pos)) continue

    const lineEnd = text.indexOf('\n', pos)
    const close = findClosingHighlight(
      text,
      pos + 2,
      lineEnd === -1 ? text.length : lineEnd,
      ignoredRanges,
      ignoredIndex,
    )

    if (close === null) continue

    const inner = text.slice(pos + 2, close)
    if (!inner.trim()) continue

    ranges.push({ from: pos, to: close + 2 })
    pos = close + 1
  }

  return ranges
}

function findClosingDisplayMath(
  text: string,
  from: number,
  ignoredRanges: PreviewIgnoredRange[],
  ignoredIndex: number,
): number | null {
  let index = ignoredIndex

  for (let pos = from; pos < text.length - 1; pos++) {
    const visible = skipIgnoredRange(pos, ignoredRanges, index)
    pos = visible.position
    index = visible.index
    if (pos >= text.length - 1) break

    if (text[pos] === '$' && text[pos + 1] === '$' && !isEscaped(text, pos)) {
      return pos
    }
  }

  return null
}

function findClosingInlineMath(
  text: string,
  from: number,
  to: number,
  ignoredRanges: PreviewIgnoredRange[],
  ignoredIndex: number,
): number | null {
  let index = ignoredIndex

  for (let pos = from; pos < to; pos++) {
    const visible = skipIgnoredRange(pos, ignoredRanges, index)
    pos = visible.position
    index = visible.index
    if (pos >= to) break

    if (text[pos] !== '$' || isEscaped(text, pos)) continue
    if (/\s/.test(text[pos - 1] ?? '')) continue
    return pos
  }

  return null
}

function findMathRanges(state: EditorState): MathRange[] {
  const text = state.doc.toString()
  const ignoredRanges = collectIgnoredRanges(state)
  const ranges: MathRange[] = []
  let ignoredIndex = 0

  for (let pos = 0; pos < text.length; pos++) {
    const visible = skipIgnoredRange(pos, ignoredRanges, ignoredIndex)
    pos = visible.position
    ignoredIndex = visible.index
    if (pos >= text.length) break

    if (text[pos] !== '$' || isEscaped(text, pos)) continue

    if (text[pos + 1] === '$') {
      const close = findClosingDisplayMath(text, pos + 2, ignoredRanges, ignoredIndex)
      if (close !== null) {
        const expression = normalizeMathExpression(text.slice(pos + 2, close))
        if (expression) {
          const isMultiline = text.slice(pos, close + 2).includes('\n')
          if (
            isMultiline &&
            (!isStandaloneMathDelimiter(text, pos, pos + 2) ||
              !isStandaloneMathDelimiter(text, close, close + 2))
          ) {
            continue
          }

          ranges.push({
            from: pos,
            to: close + 2,
            expression,
            displayMode: true,
          })
          pos = close + 1
          continue
        }
      }

      continue
    }

    const lineEnd = text.indexOf('\n', pos)
    const close = findClosingInlineMath(
      text,
      pos + 1,
      lineEnd === -1 ? text.length : lineEnd,
      ignoredRanges,
      ignoredIndex,
    )

    if (close === null) continue

    const expression = normalizeMathExpression(text.slice(pos + 1, close))
    if (!expression) continue
    if (/\s/.test(text[pos + 1] ?? '')) continue

    ranges.push({
      from: pos,
      to: close + 1,
      expression,
      displayMode: false,
    })
    pos = close
  }

  return ranges
}

type FenceChar = '`' | '~'

interface FenceDescriptor {
  char: FenceChar
  length: number
  info: string
}

function parseFenceDescriptor(text: string): FenceDescriptor | null {
  const normalized = text.replace(/^\s{0,3}/, '')
  const char = normalized[0]

  if (char !== '`' && char !== '~') return null

  let length = 0
  while (normalized[length] === char) {
    length++
  }

  if (length < 3) return null

  return {
    char,
    length,
    info: normalized.slice(length).trim(),
  }
}

function isMermaidFenceInfo(info: string): boolean {
  return info.split(/\s+/, 1)[0]?.toLowerCase() === 'mermaid'
}

function isClosingFence(text: string, fence: FenceDescriptor): boolean {
  const normalized = text.replace(/^\s{0,3}/, '')
  let length = 0

  while (normalized[length] === fence.char) {
    length++
  }

  return length >= fence.length && normalized.slice(length).trim().length === 0
}

function isMermaidFenceBlock(text: string): boolean {
  const firstLine = text.split('\n', 1)[0] ?? ''
  const fence = parseFenceDescriptor(firstLine)
  return fence !== null && isMermaidFenceInfo(fence.info)
}

function findMermaidBlocks(state: EditorState): MermaidBlockRange[] {
  const blocks: MermaidBlockRange[] = []

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber)
    const openingFence = parseFenceDescriptor(line.text)

    if (!openingFence || !isMermaidFenceInfo(openingFence.info)) {
      continue
    }

    let closingLineNumber = lineNumber + 1
    while (closingLineNumber <= state.doc.lines) {
      if (isClosingFence(state.doc.line(closingLineNumber).text, openingFence)) {
        break
      }
      closingLineNumber++
    }

    if (closingLineNumber > state.doc.lines) {
      continue
    }

    const definitionLines: string[] = []
    for (let contentLine = lineNumber + 1; contentLine < closingLineNumber; contentLine++) {
      definitionLines.push(state.doc.line(contentLine).text)
    }

    blocks.push({
      from: line.from,
      to: state.doc.line(closingLineNumber).to,
      firstLineFrom: line.from,
      firstLineTo: line.to,
      lastLineNumber: closingLineNumber,
      definition: definitionLines.join('\n'),
    })

    lineNumber = closingLineNumber
  }

  return blocks
}

// --- Bullet widget ---

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span')
    span.textContent = '•'
    span.className = 'cm-md-bullet'
    return span
  }

  eq() {
    return true
  }
}

class OrderedListWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.textContent = this.text
    span.className = 'cm-md-list-number'
    return span
  }

  eq(other: OrderedListWidget) {
    return this.text === other.text
  }
}

// --- Checkbox widget ---

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly checkboxFrom: number,
    readonly checkboxTo: number,
  ) {
    super()
  }

  toDOM(view: EditorView) {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = this.checked
    input.className = 'cm-md-checkbox'
    input.setAttribute('aria-label', this.checked ? 'Checked task' : 'Unchecked task')
    input.addEventListener('mousedown', (e) => {
      e.preventDefault()
    })
    input.addEventListener('click', (e) => {
      e.preventDefault()
      const current = view.state.sliceDoc(this.checkboxFrom, this.checkboxTo)
      const normalized = current.toLowerCase()
      let next: string | null = null
      if (normalized === '[ ]') {
        next = '[x]'
      } else if (normalized === '[x]') {
        next = '[ ]'
      }
      if (!next) return

      view.dispatch({
        changes: {
          from: this.checkboxFrom,
          to: this.checkboxTo,
          insert: next,
        },
      })
      view.focus()
    })
    return input
  }

  eq(other: CheckboxWidget) {
    return (
      this.checked === other.checked &&
      this.checkboxFrom === other.checkboxFrom &&
      this.checkboxTo === other.checkboxTo
    )
  }

  ignoreEvent(event: Event) {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

// --- Horizontal rule widget ---

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-md-hr'
    return hr
  }

  eq() {
    return true
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly expression: string,
    readonly displayMode: boolean,
  ) {
    super()
  }

  toDOM() {
    const tagName = this.displayMode ? 'div' : 'span'
    const container = document.createElement(tagName)
    container.className = this.displayMode ? 'cm-md-math cm-md-math-block' : 'cm-md-math cm-md-math-inline'

    const fallback = document.createElement(tagName)
    fallback.className = 'cm-md-math-fallback'
    fallback.textContent = this.displayMode
      ? `$$\n${this.expression}\n$$`
      : `$${this.expression}$`
    container.append(fallback)

    const render = (katex: KatexRenderer | null) => {
      if (!katex) {
        container.classList.add('cm-md-math-error')
        return
      }

      container.textContent = ''

      try {
        katex.render(this.expression, container, {
          displayMode: this.displayMode,
          throwOnError: false,
        })
      } catch {
        container.classList.add('cm-md-math-error')
        container.textContent = fallback.textContent
      }
    }

    if (window.katex) {
      render(window.katex)
    } else {
      void ensureKatexLoaded().then(render)
    }

    return container
  }

  eq(other: MathWidget) {
    return this.expression === other.expression && this.displayMode === other.displayMode
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly definition: string) {
    super()
  }

  toDOM() {
    const container = document.createElement('div')
    container.className = 'cm-md-mermaid'

    const fallback = document.createElement('pre')
    fallback.className = 'cm-md-mermaid-fallback'
    fallback.textContent = this.definition
    container.append(fallback)

    const render = async (renderer: MermaidRenderer | null) => {
      if (!renderer) {
        container.classList.add('cm-md-mermaid-error')
        return
      }

      try {
        const result = await renderer.render(`collabmd-mermaid-${++mermaidGraphCounter}`, this.definition)
        container.innerHTML = result.svg
        container.querySelector('svg')?.classList.add('cm-md-mermaid-svg')
        result.bindFunctions?.(container)
      } catch {
        container.classList.add('cm-md-mermaid-error')
        container.textContent = ''
        container.append(fallback)
      }
    }

    if (window.mermaid) {
      void render(initializeMermaid(window.mermaid))
    } else {
      void ensureMermaidLoaded().then(render)
    }

    return container
  }

  eq(other: MermaidWidget) {
    return this.definition === other.definition
  }
}

function consumeLineWhitespace(state: EditorState, from: number, lineTo: number): number {
  let position = from
  while (position < lineTo) {
    const char = state.sliceDoc(position, position + 1)
    if (char !== ' ' && char !== '\t') break
    position++
  }
  return position
}

function matchListPrefix(state: EditorState, from: number, to: number): ListPrefixMatch | null {
  const line = state.doc.lineAt(from)
  const markText = state.sliceDoc(from, to).trim()
  const afterMarkWhitespace = consumeLineWhitespace(state, to, line.to)
  if (afterMarkWhitespace > line.to) return null

  if (markText === '-' || markText === '*' || markText === '+') {
    const taskMarker = state.sliceDoc(afterMarkWhitespace, afterMarkWhitespace + 3)
    if (taskMarker === '[ ]' || taskMarker.toLowerCase() === '[x]') {
      const afterTaskWhitespace = consumeLineWhitespace(state, afterMarkWhitespace + 3, line.to)
      return {
        kind: 'checkbox',
        replaceTo: afterTaskWhitespace,
        checked: taskMarker.toLowerCase() === '[x]',
        checkboxFrom: afterMarkWhitespace,
        checkboxTo: afterMarkWhitespace + 3,
      }
    }

    return {
      kind: 'bullet',
      replaceTo: afterMarkWhitespace,
    }
  }

  if (/^\d+[.)]$/.test(markText)) {
    return {
      kind: 'ordered',
      replaceTo: afterMarkWhitespace,
      markerText: markText,
    }
  }

  return null
}

// --- Build decorations from syntax tree ---

function buildDecorations(state: EditorState): DecorationSet {
  if (!state.field(previewEnabled)) return Decoration.none

  const decorations: Range<Decoration>[] = []
  const tree = syntaxTree(state)
  const cursorHead = state.selection.main.head

  tree.iterate({
    enter(node) {
      const { from, to } = node
      const lineFrom = state.doc.lineAt(from)
      const lineTo = state.doc.lineAt(to)
      const cursorLine = state.doc.lineAt(cursorHead)

      const cursorOnNode =
        cursorLine.number >= lineFrom.number && cursorLine.number <= lineTo.number

      switch (node.name) {
        // --- Headings ---
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6': {
          const level = parseInt(node.name.slice(-1))
          const headingClasses: Record<number, string> = {
            1: 'cm-md-h1',
            2: 'cm-md-h2',
            3: 'cm-md-h3',
            4: 'cm-md-h4',
            5: 'cm-md-h5',
            6: 'cm-md-h6',
          }
          // Find the HeaderMark (the # symbols)
          const markNode = node.node.getChild('HeaderMark')
          if (markNode) {
            const markerTo = Math.min(markNode.to + 1, lineFrom.to)
            if (markNode.from < markerTo) {
              if (cursorOnNode) {
                decorations.push(
                  Decoration.mark({ class: 'cm-md-marker' }).range(markNode.from, markerTo),
                )
              } else {
                decorations.push(Decoration.replace({}).range(markNode.from, markerTo))
              }
            }
          }
          // Apply heading style to the rest
          decorations.push(Decoration.line({ class: headingClasses[level] }).range(lineFrom.from))
          break
        }

        // --- Bold ---
        case 'StrongEmphasis': {
          const text = state.sliceDoc(from, to)
          // Determine marker length (** or __)
          const marker = text.startsWith('**') ? '**' : '__'
          const mLen = marker.length
          if (cursorOnNode) {
            decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(from, from + mLen))
            decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(to - mLen, to))
          } else {
            decorations.push(Decoration.replace({}).range(from, from + mLen))
            decorations.push(Decoration.replace({}).range(to - mLen, to))
          }
          // Style the inner text
          if (from + mLen < to - mLen) {
            decorations.push(Decoration.mark({ class: 'cm-md-bold' }).range(from + mLen, to - mLen))
          }
          break
        }

        // --- Italic ---
        case 'Emphasis': {
          const text = state.sliceDoc(from, to)
          const marker = text.startsWith('*') ? '*' : '_'
          if (cursorOnNode) {
            decorations.push(
              Decoration.mark({ class: 'cm-md-marker' }).range(from, from + marker.length),
            )
            decorations.push(
              Decoration.mark({ class: 'cm-md-marker' }).range(to - marker.length, to),
            )
          } else {
            decorations.push(Decoration.replace({}).range(from, from + marker.length))
            decorations.push(Decoration.replace({}).range(to - marker.length, to))
          }
          // Style the inner text
          if (from + marker.length < to - marker.length) {
            decorations.push(
              Decoration.mark({ class: 'cm-md-italic' }).range(
                from + marker.length,
                to - marker.length,
              ),
            )
          }
          break
        }

        // --- Strikethrough ---
        case 'Strikethrough': {
          if (cursorOnNode) {
            decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(from, from + 2))
            decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(to - 2, to))
          } else {
            decorations.push(Decoration.replace({}).range(from, from + 2))
            decorations.push(Decoration.replace({}).range(to - 2, to))
          }
          if (from + 2 < to - 2) {
            decorations.push(
              Decoration.mark({ class: 'cm-md-strikethrough' }).range(from + 2, to - 2),
            )
          }
          break
        }

        // --- Inline code ---
        case 'InlineCode': {
          if (cursorOnNode) {
            decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(from, from + 1))
            decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(to - 1, to))
          } else {
            decorations.push(Decoration.replace({}).range(from, from + 1))
            decorations.push(Decoration.replace({}).range(to - 1, to))
          }
          if (from + 1 < to - 1) {
            decorations.push(Decoration.mark({ class: 'cm-md-code' }).range(from + 1, to - 1))
          }
          break
        }

        // --- Code blocks ---
        case 'FencedCode': {
          if (cursorOnNode) break
          if (isMermaidFenceBlock(state.sliceDoc(from, to))) break
          decorations.push(Decoration.mark({ class: 'cm-md-codeblock' }).range(from, to))
          break
        }

        // --- Links ---
        case 'Link': {
          if (cursorOnNode) break
          const linkNode = node.node
          const urlNode = linkNode.getChild('URL')
          // Get the link text from between [ and ]
          const fullText = state.sliceDoc(from, to)
          const textMatch = fullText.match(/^\[([^\]]*)\]/)
          const linkText = textMatch ? textMatch[1] : fullText
          const url = urlNode ? state.sliceDoc(urlNode.from, urlNode.to) : ''

          if (linkText && url && isSafeLink(url)) {
            decorations.push(
              Decoration.replace({
                widget: new LinkWidget(linkText, url),
              }).range(from, to),
            )
          }
          break
        }

        // --- Bullet lists ---
        case 'ListMark': {
          if (cursorOnNode) break
          const prefix = matchListPrefix(state, from, to)
          if (!prefix) break

          if (prefix.kind === 'checkbox') {
            decorations.push(
              Decoration.replace({
                widget: new CheckboxWidget(
                  prefix.checked ?? false,
                  prefix.checkboxFrom ?? from,
                  prefix.checkboxTo ?? to,
                ),
              }).range(from, prefix.replaceTo),
            )
            break
          }

          if (prefix.kind === 'ordered') {
            decorations.push(
              Decoration.replace({
                widget: new OrderedListWidget(prefix.markerText ?? ''),
              }).range(from, prefix.replaceTo),
            )
            break
          }

          decorations.push(
            Decoration.replace({
              widget: new BulletWidget(),
            }).range(from, prefix.replaceTo),
          )
          break
        }

        // --- Horizontal rule ---
        case 'HorizontalRule': {
          if (cursorOnNode) break
          decorations.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(),
            }).range(from, to),
          )
          break
        }

        // --- Blockquote ---
        case 'Blockquote': {
          // Apply line decoration for each line in the blockquote
          for (let i = lineFrom.number; i <= lineTo.number; i++) {
            const line = state.doc.line(i)
            decorations.push(Decoration.line({ class: 'cm-md-blockquote' }).range(line.from))
          }
          break
        }
      }
    },
  })

  for (const range of findMathRanges(state)) {
    const cursorOnMath = cursorHead >= range.from && cursorHead <= range.to
    if (cursorOnMath) continue

    if (range.displayMode && state.sliceDoc(range.from, range.to).includes('\n')) {
      const firstLine = state.doc.lineAt(range.from)
      const lastLine = state.doc.lineAt(Math.max(range.to - 1, range.from))

      decorations.push(
        Decoration.replace({
          widget: new MathWidget(range.expression, true),
        }).range(firstLine.from, firstLine.to),
      )

      for (let lineNumber = firstLine.number + 1; lineNumber <= lastLine.number; lineNumber++) {
        const line = state.doc.line(lineNumber)
        if (line.length > 0) {
          decorations.push(Decoration.replace({}).range(line.from, line.to))
        }
        decorations.push(Decoration.line({ class: 'cm-md-hidden-line' }).range(line.from))
      }
      continue
    }

    decorations.push(
      Decoration.replace({
        widget: new MathWidget(range.expression, range.displayMode),
      }).range(range.from, range.to),
    )
  }

  for (const block of findMermaidBlocks(state)) {
    const cursorOnBlock = cursorHead >= block.from && cursorHead <= block.to
    if (cursorOnBlock) continue

    decorations.push(
      Decoration.replace({
        widget: new MermaidWidget(block.definition),
      }).range(block.firstLineFrom, block.firstLineTo),
    )

    for (let lineNumber = state.doc.lineAt(block.firstLineFrom).number + 1; lineNumber <= block.lastLineNumber; lineNumber++) {
      const line = state.doc.line(lineNumber)
      if (line.length > 0) {
        decorations.push(Decoration.replace({}).range(line.from, line.to))
      }
      decorations.push(Decoration.line({ class: 'cm-md-hidden-line' }).range(line.from))
    }
  }

  const cursorLine = state.doc.lineAt(cursorHead)
  for (const range of findHighlightRanges(state)) {
    const lineFrom = state.doc.lineAt(range.from)
    const lineTo = state.doc.lineAt(range.to)
    const cursorOnRange =
      cursorLine.number >= lineFrom.number && cursorLine.number <= lineTo.number

    if (cursorOnRange) {
      decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(range.from, range.from + 2))
      decorations.push(Decoration.mark({ class: 'cm-md-marker' }).range(range.to - 2, range.to))
    } else {
      decorations.push(Decoration.replace({}).range(range.from, range.from + 2))
      decorations.push(Decoration.replace({}).range(range.to - 2, range.to))
    }

    if (range.from + 2 < range.to - 2) {
      decorations.push(
        Decoration.mark({ class: 'cm-md-highlight' }).range(range.from + 2, range.to - 2),
      )
    }
  }

  return Decoration.set(decorations, true)
}

// --- ViewPlugin ---

export const markdownPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.some((t) => t.effects.some((e) => e.is(togglePreviewEffect)))
      ) {
        this.decorations = buildDecorations(update.state)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

// --- Theme for preview decorations ---

export const markdownPreviewTheme = EditorView.theme({
  '.cm-md-h1': {
    fontSize: '1.75em',
    fontWeight: '700',
    lineHeight: '1.3',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h2': {
    fontSize: '1.45em',
    fontWeight: '600',
    lineHeight: '1.35',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h3': {
    fontSize: '1.2em',
    fontWeight: '600',
    lineHeight: '1.4',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h4': {
    fontSize: '1.1em',
    fontWeight: '600',
    lineHeight: '1.4',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h5': {
    fontSize: '1.05em',
    fontWeight: '600',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-h6': {
    fontSize: '1em',
    fontWeight: '600',
    color: '#6b7280',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  '.cm-md-bold': {
    fontWeight: '700',
  },
  '.cm-md-italic': {
    fontStyle: 'italic',
  },
  '.cm-md-strikethrough': {
    textDecoration: 'line-through',
    color: '#9ca3af',
  },
  '.cm-md-highlight': {
    backgroundColor: 'rgba(194, 104, 43, 0.18)',
    borderRadius: '3px',
    padding: '0 1px',
  },
  '.cm-md-code': {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.9em',
    backgroundColor: '#f3f4f6',
    borderRadius: '3px',
    padding: '1px 4px',
  },
  '.cm-md-codeblock': {
    backgroundColor: '#f9fafb',
    borderRadius: '4px',
  },
  '.cm-md-link': {
    color: '#2563eb',
    textDecoration: 'underline',
    textDecorationColor: '#93c5fd',
    cursor: 'pointer',
    '&:hover': {
      textDecorationColor: '#2563eb',
    },
  },
  '.cm-md-bullet': {
    color: '#6b7280',
    fontSize: '0.9em',
    display: 'inline-block',
    minWidth: '1.25em',
  },
  '.cm-md-list-number': {
    color: '#6b7280',
    fontSize: '0.9em',
    display: 'inline-block',
    minWidth: '1.75em',
  },
  '.cm-md-checkbox': {
    verticalAlign: 'middle',
    cursor: 'pointer',
    marginRight: '0.5em',
  },
  '.cm-md-marker': {
    opacity: '0.35',
    color: '#9ca3af',
  },
  '.cm-md-hr': {
    border: 'none',
    borderTop: '2px solid #e5e7eb',
    margin: '8px 0',
  },
  '.cm-md-blockquote': {
    borderLeft: '3px solid #d1d5db',
    paddingLeft: '12px',
    color: '#6b7280',
  },
  '.cm-md-math': {
    verticalAlign: 'middle',
  },
  '.cm-md-math-inline': {
    display: 'inline-flex',
    maxWidth: '100%',
    overflowX: 'auto',
    padding: '0 0.1em',
  },
  '.cm-md-math-block': {
    display: 'block',
    margin: '12px 0',
    overflowX: 'auto',
    padding: '8px 0',
  },
  '.cm-md-math-fallback': {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.95em',
    color: '#4b5563',
    whiteSpace: 'pre-wrap',
  },
  '.cm-md-math-error': {
    color: '#b45309',
  },
  '.cm-md-mermaid': {
    display: 'block',
    margin: '12px 0',
    padding: '12px',
    backgroundColor: '#fcfcfb',
    border: '1px solid #e7e5e4',
    borderRadius: '8px',
    overflowX: 'auto',
  },
  '.cm-md-mermaid-svg': {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
    margin: '0 auto',
  },
  '.cm-md-mermaid-fallback': {
    margin: '0',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '0.9em',
    color: '#4b5563',
    whiteSpace: 'pre-wrap',
  },
  '.cm-md-mermaid-error': {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  '.cm-md-hidden-line': {
    display: 'none',
  },
})
