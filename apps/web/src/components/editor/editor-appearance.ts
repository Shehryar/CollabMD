import type { CSSProperties } from 'react'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export type EditorAppearanceId = 'light' | 'dark' | 'midnight' | 'dracula'

interface EditorAppearancePalette {
  editorBg: string
  editorText: string
  editorMuted: string
  editorBorder: string
  editorPanelBg: string
  editorPanelBgSubtle: string
  editorPanelHover: string
  editorActiveLine: string
  editorSelection: string
  editorCursor: string
  editorGutter: string
  editorGutterActive: string
  editorCommentPendingBg: string
  editorCommentPendingBorder: string
  editorCommentHighlight: string
  editorCommentHighlightResolved: string
  editorCommentHighlightActive: string
  editorCommentHighlightShadow: string
  editorCommentHighlightActiveShadow: string
  editorMarkdownMarker: string
  editorMarkdownHeading: string
  editorMarkdownHeadingAlt: string
  editorMarkdownCodeBg: string
  editorMarkdownCodeText: string
  editorMarkdownLink: string
  editorMarkdownLinkUnderline: string
  editorMarkdownQuoteBorder: string
  editorMarkdownQuoteText: string
  editorMarkdownTableBg: string
  editorMarkdownTableHeaderBg: string
  editorMarkdownTableBorder: string
  editorMarkdownTableText: string
  editorMermaidBg: string
  editorMermaidBorder: string
  editorConflictCurrent: string
  editorConflictIncoming: string
  editorConflictMarkerBg: string
  editorConflictMarkerText: string
  editorConflictButtonBg: string
  editorConflictButtonBorder: string
  editorConflictButtonText: string
  editorConflictButtonHover: string
}

export interface EditorAppearance {
  id: EditorAppearanceId
  label: string
  palette: EditorAppearancePalette
  highlightStyle: HighlightStyle
}

function createHighlightStyle(colors: {
  keyword: string
  heading: string
  string: string
  number: string
  comment: string
  atom: string
  emphasis: string
  strong: string
  mono: string
  link: string
  quote: string
  invalid: string
}) {
  return HighlightStyle.define([
    { tag: [t.heading1, t.heading2, t.heading3, t.heading4], color: colors.heading, fontWeight: '700' },
    { tag: [t.heading5, t.heading6], color: colors.heading, fontWeight: '600' },
    { tag: [t.strong], color: colors.strong, fontWeight: '700' },
    { tag: [t.emphasis], color: colors.emphasis, fontStyle: 'italic' },
    { tag: [t.keyword, t.modifier], color: colors.keyword },
    { tag: [t.string, t.special(t.string)], color: colors.string },
    { tag: [t.number, t.integer, t.float, t.bool], color: colors.number },
    { tag: [t.atom, t.labelName], color: colors.atom },
    { tag: [t.url, t.link], color: colors.link, textDecoration: 'underline' },
    { tag: [t.quote], color: colors.quote },
    { tag: [t.comment, t.lineComment, t.blockComment], color: colors.comment, fontStyle: 'italic' },
    { tag: [t.monospace, t.content], color: colors.mono },
    { tag: [t.invalid], color: colors.invalid },
  ])
}

export const editorAppearances: EditorAppearance[] = [
  {
    id: 'light',
    label: 'Light',
    palette: {
      editorBg: '#fffdf8',
      editorText: '#1f2937',
      editorMuted: '#6b7280',
      editorBorder: '#e5e7eb',
      editorPanelBg: '#fffdf8',
      editorPanelBgSubtle: '#f8f6f1',
      editorPanelHover: '#f2efe8',
      editorActiveLine: '#f6f3ec',
      editorSelection: 'rgba(194, 104, 43, 0.26)',
      editorCursor: '#111827',
      editorGutter: '#9ca3af',
      editorGutterActive: '#6b7280',
      editorCommentPendingBg: 'rgba(251, 191, 36, 0.22)',
      editorCommentPendingBorder: 'rgba(245, 158, 11, 0.55)',
      editorCommentHighlight: 'rgba(250, 204, 21, 0.34)',
      editorCommentHighlightResolved: 'rgba(253, 224, 71, 0.18)',
      editorCommentHighlightActive: 'rgba(251, 191, 36, 0.46)',
      editorCommentHighlightShadow: 'rgba(217, 119, 6, 0.25)',
      editorCommentHighlightActiveShadow: 'rgba(217, 119, 6, 0.5)',
      editorMarkdownMarker: '#9ca3af',
      editorMarkdownHeading: '#6d28d9',
      editorMarkdownHeadingAlt: '#7c3aed',
      editorMarkdownCodeBg: '#f3f4f6',
      editorMarkdownCodeText: '#374151',
      editorMarkdownLink: '#2563eb',
      editorMarkdownLinkUnderline: '#93c5fd',
      editorMarkdownQuoteBorder: '#d1d5db',
      editorMarkdownQuoteText: '#6b7280',
      editorMarkdownTableBg: '#ffffff',
      editorMarkdownTableHeaderBg: '#f8fafc',
      editorMarkdownTableBorder: '#e5e7eb',
      editorMarkdownTableText: '#111827',
      editorMermaidBg: '#fcfcfb',
      editorMermaidBorder: '#e7e5e4',
      editorConflictCurrent: 'rgba(34, 197, 94, 0.08)',
      editorConflictIncoming: 'rgba(59, 130, 246, 0.08)',
      editorConflictMarkerBg: '#f3f4f6',
      editorConflictMarkerText: '#9ca3af',
      editorConflictButtonBg: '#ffffff',
      editorConflictButtonBorder: '#e5e7eb',
      editorConflictButtonText: '#374151',
      editorConflictButtonHover: '#f9fafb',
    },
    highlightStyle: createHighlightStyle({
      keyword: '#7c3aed',
      heading: '#6d28d9',
      string: '#0f766e',
      number: '#c2410c',
      comment: '#9ca3af',
      atom: '#2563eb',
      emphasis: '#7c2d12',
      strong: '#b45309',
      mono: '#374151',
      link: '#2563eb',
      quote: '#6b7280',
      invalid: '#dc2626',
    }),
  },
  {
    id: 'dark',
    label: 'Dark',
    palette: {
      editorBg: '#1f2430',
      editorText: '#e6e1cf',
      editorMuted: '#a7adba',
      editorBorder: '#343b4d',
      editorPanelBg: '#1f2430',
      editorPanelBgSubtle: '#272d3b',
      editorPanelHover: '#313849',
      editorActiveLine: '#2b3142',
      editorSelection: 'rgba(125, 207, 255, 0.24)',
      editorCursor: '#f8fafc',
      editorGutter: '#7d8596',
      editorGutterActive: '#d6dceb',
      editorCommentPendingBg: 'rgba(251, 191, 36, 0.18)',
      editorCommentPendingBorder: 'rgba(251, 191, 36, 0.5)',
      editorCommentHighlight: 'rgba(250, 204, 21, 0.24)',
      editorCommentHighlightResolved: 'rgba(250, 204, 21, 0.12)',
      editorCommentHighlightActive: 'rgba(251, 191, 36, 0.35)',
      editorCommentHighlightShadow: 'rgba(251, 191, 36, 0.24)',
      editorCommentHighlightActiveShadow: 'rgba(251, 191, 36, 0.46)',
      editorMarkdownMarker: '#7d8596',
      editorMarkdownHeading: '#c792ea',
      editorMarkdownHeadingAlt: '#c792ea',
      editorMarkdownCodeBg: '#272d3b',
      editorMarkdownCodeText: '#d6deeb',
      editorMarkdownLink: '#7dcfff',
      editorMarkdownLinkUnderline: '#4fa3d1',
      editorMarkdownQuoteBorder: '#58647a',
      editorMarkdownQuoteText: '#b8c1d1',
      editorMarkdownTableBg: '#232938',
      editorMarkdownTableHeaderBg: '#2c3344',
      editorMarkdownTableBorder: '#3a4358',
      editorMarkdownTableText: '#e6e1cf',
      editorMermaidBg: '#232938',
      editorMermaidBorder: '#3a4358',
      editorConflictCurrent: 'rgba(34, 197, 94, 0.14)',
      editorConflictIncoming: 'rgba(59, 130, 246, 0.16)',
      editorConflictMarkerBg: '#272d3b',
      editorConflictMarkerText: '#a7adba',
      editorConflictButtonBg: '#232938',
      editorConflictButtonBorder: '#46506a',
      editorConflictButtonText: '#e6e1cf',
      editorConflictButtonHover: '#2f3749',
    },
    highlightStyle: createHighlightStyle({
      keyword: '#7dcfff',
      heading: '#c792ea',
      string: '#7ee787',
      number: '#f78c6c',
      comment: '#7d8596',
      atom: '#82aaff',
      emphasis: '#ffd580',
      strong: '#ffb454',
      mono: '#d6deeb',
      link: '#7dcfff',
      quote: '#b8c1d1',
      invalid: '#ff757f',
    }),
  },
  {
    id: 'midnight',
    label: 'Midnight',
    palette: {
      editorBg: '#111827',
      editorText: '#e5e7eb',
      editorMuted: '#94a3b8',
      editorBorder: '#243041',
      editorPanelBg: '#111827',
      editorPanelBgSubtle: '#172133',
      editorPanelHover: '#1e293b',
      editorActiveLine: '#162033',
      editorSelection: 'rgba(96, 165, 250, 0.22)',
      editorCursor: '#f9fafb',
      editorGutter: '#64748b',
      editorGutterActive: '#cbd5e1',
      editorCommentPendingBg: 'rgba(245, 158, 11, 0.18)',
      editorCommentPendingBorder: 'rgba(245, 158, 11, 0.5)',
      editorCommentHighlight: 'rgba(251, 191, 36, 0.22)',
      editorCommentHighlightResolved: 'rgba(251, 191, 36, 0.1)',
      editorCommentHighlightActive: 'rgba(251, 191, 36, 0.32)',
      editorCommentHighlightShadow: 'rgba(245, 158, 11, 0.22)',
      editorCommentHighlightActiveShadow: 'rgba(245, 158, 11, 0.4)',
      editorMarkdownMarker: '#64748b',
      editorMarkdownHeading: '#a78bfa',
      editorMarkdownHeadingAlt: '#c4b5fd',
      editorMarkdownCodeBg: '#172133',
      editorMarkdownCodeText: '#e2e8f0',
      editorMarkdownLink: '#93c5fd',
      editorMarkdownLinkUnderline: '#60a5fa',
      editorMarkdownQuoteBorder: '#475569',
      editorMarkdownQuoteText: '#cbd5e1',
      editorMarkdownTableBg: '#172133',
      editorMarkdownTableHeaderBg: '#1e293b',
      editorMarkdownTableBorder: '#334155',
      editorMarkdownTableText: '#e2e8f0',
      editorMermaidBg: '#172133',
      editorMermaidBorder: '#334155',
      editorConflictCurrent: 'rgba(34, 197, 94, 0.12)',
      editorConflictIncoming: 'rgba(96, 165, 250, 0.14)',
      editorConflictMarkerBg: '#172133',
      editorConflictMarkerText: '#94a3b8',
      editorConflictButtonBg: '#111827',
      editorConflictButtonBorder: '#334155',
      editorConflictButtonText: '#e5e7eb',
      editorConflictButtonHover: '#1e293b',
    },
    highlightStyle: createHighlightStyle({
      keyword: '#93c5fd',
      heading: '#c4b5fd',
      string: '#4ade80',
      number: '#fb923c',
      comment: '#64748b',
      atom: '#38bdf8',
      emphasis: '#fbbf24',
      strong: '#fdba74',
      mono: '#e2e8f0',
      link: '#93c5fd',
      quote: '#cbd5e1',
      invalid: '#f87171',
    }),
  },
  {
    id: 'dracula',
    label: 'Dracula',
    palette: {
      editorBg: '#282a36',
      editorText: '#f8f8f2',
      editorMuted: '#a4a8c1',
      editorBorder: '#44475a',
      editorPanelBg: '#282a36',
      editorPanelBgSubtle: '#303341',
      editorPanelHover: '#383a4c',
      editorActiveLine: '#313442',
      editorSelection: 'rgba(189, 147, 249, 0.24)',
      editorCursor: '#f8f8f2',
      editorGutter: '#6272a4',
      editorGutterActive: '#f8f8f2',
      editorCommentPendingBg: 'rgba(255, 184, 108, 0.18)',
      editorCommentPendingBorder: 'rgba(255, 184, 108, 0.48)',
      editorCommentHighlight: 'rgba(255, 184, 108, 0.22)',
      editorCommentHighlightResolved: 'rgba(255, 184, 108, 0.1)',
      editorCommentHighlightActive: 'rgba(255, 184, 108, 0.32)',
      editorCommentHighlightShadow: 'rgba(255, 184, 108, 0.24)',
      editorCommentHighlightActiveShadow: 'rgba(255, 184, 108, 0.44)',
      editorMarkdownMarker: '#6272a4',
      editorMarkdownHeading: '#bd93f9',
      editorMarkdownHeadingAlt: '#ff79c6',
      editorMarkdownCodeBg: '#303341',
      editorMarkdownCodeText: '#8be9fd',
      editorMarkdownLink: '#8be9fd',
      editorMarkdownLinkUnderline: '#6272a4',
      editorMarkdownQuoteBorder: '#6272a4',
      editorMarkdownQuoteText: '#f1fa8c',
      editorMarkdownTableBg: '#303341',
      editorMarkdownTableHeaderBg: '#343746',
      editorMarkdownTableBorder: '#44475a',
      editorMarkdownTableText: '#f8f8f2',
      editorMermaidBg: '#303341',
      editorMermaidBorder: '#44475a',
      editorConflictCurrent: 'rgba(80, 250, 123, 0.14)',
      editorConflictIncoming: 'rgba(139, 233, 253, 0.16)',
      editorConflictMarkerBg: '#303341',
      editorConflictMarkerText: '#a4a8c1',
      editorConflictButtonBg: '#282a36',
      editorConflictButtonBorder: '#6272a4',
      editorConflictButtonText: '#f8f8f2',
      editorConflictButtonHover: '#383a4c',
    },
    highlightStyle: createHighlightStyle({
      keyword: '#ff79c6',
      heading: '#bd93f9',
      string: '#f1fa8c',
      number: '#bd93f9',
      comment: '#6272a4',
      atom: '#8be9fd',
      emphasis: '#ffb86c',
      strong: '#ffb86c',
      mono: '#8be9fd',
      link: '#8be9fd',
      quote: '#f1fa8c',
      invalid: '#ff5555',
    }),
  },
]

export const defaultEditorAppearanceId: EditorAppearanceId = 'light'
export const EDITOR_APPEARANCE_STORAGE_KEY = 'collabmd.editorAppearance'
export const EDITOR_APPEARANCE_EVENT = 'collabmd:set-editor-appearance'

export function getEditorAppearance(id: EditorAppearanceId): EditorAppearance {
  return editorAppearances.find((theme) => theme.id === id) ?? editorAppearances[0]
}

export function isEditorAppearanceId(value: string): value is EditorAppearanceId {
  return editorAppearances.some((theme) => theme.id === value)
}

export function getEditorAppearanceStyle(theme: EditorAppearance): CSSProperties {
  const p = theme.palette
  return {
    '--editor-bg': p.editorBg,
    '--editor-text': p.editorText,
    '--editor-muted': p.editorMuted,
    '--editor-border': p.editorBorder,
    '--editor-panel-bg': p.editorPanelBg,
    '--editor-panel-bg-subtle': p.editorPanelBgSubtle,
    '--editor-panel-hover': p.editorPanelHover,
    '--editor-active-line': p.editorActiveLine,
    '--editor-selection': p.editorSelection,
    '--editor-cursor': p.editorCursor,
    '--editor-gutter': p.editorGutter,
    '--editor-gutter-active': p.editorGutterActive,
    '--editor-comment-pending-bg': p.editorCommentPendingBg,
    '--editor-comment-pending-border': p.editorCommentPendingBorder,
    '--editor-comment-highlight': p.editorCommentHighlight,
    '--editor-comment-highlight-resolved': p.editorCommentHighlightResolved,
    '--editor-comment-highlight-active': p.editorCommentHighlightActive,
    '--editor-comment-highlight-shadow': p.editorCommentHighlightShadow,
    '--editor-comment-highlight-active-shadow': p.editorCommentHighlightActiveShadow,
    '--editor-md-marker': p.editorMarkdownMarker,
    '--editor-md-heading': p.editorMarkdownHeading,
    '--editor-md-heading-alt': p.editorMarkdownHeadingAlt,
    '--editor-md-code-bg': p.editorMarkdownCodeBg,
    '--editor-md-code-text': p.editorMarkdownCodeText,
    '--editor-md-link': p.editorMarkdownLink,
    '--editor-md-link-underline': p.editorMarkdownLinkUnderline,
    '--editor-md-quote-border': p.editorMarkdownQuoteBorder,
    '--editor-md-quote-text': p.editorMarkdownQuoteText,
    '--editor-md-table-bg': p.editorMarkdownTableBg,
    '--editor-md-table-header-bg': p.editorMarkdownTableHeaderBg,
    '--editor-md-table-border': p.editorMarkdownTableBorder,
    '--editor-md-table-text': p.editorMarkdownTableText,
    '--editor-mermaid-bg': p.editorMermaidBg,
    '--editor-mermaid-border': p.editorMermaidBorder,
    '--editor-conflict-current': p.editorConflictCurrent,
    '--editor-conflict-incoming': p.editorConflictIncoming,
    '--editor-conflict-marker-bg': p.editorConflictMarkerBg,
    '--editor-conflict-marker-text': p.editorConflictMarkerText,
    '--editor-conflict-btn-bg': p.editorConflictButtonBg,
    '--editor-conflict-btn-border': p.editorConflictButtonBorder,
    '--editor-conflict-btn-text': p.editorConflictButtonText,
    '--editor-conflict-btn-hover': p.editorConflictButtonHover,
  } as CSSProperties
}

export function getEditorAppearanceSyntaxExtension(theme: EditorAppearance) {
  return syntaxHighlighting(theme.highlightStyle, { fallback: true })
}
