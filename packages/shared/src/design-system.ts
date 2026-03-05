/**
 * CollabMD Design System
 *
 * Canonical design tokens and type scales for the entire app.
 * Import from @collabmd/shared and use with Tailwind CSS v4 or inline styles.
 *
 * Visual prototype: /design-prototype.html (root of monorepo)
 */

// ─── Fonts ───────────────────────────────────────────────────────────
// Google Fonts import (add to <head>):
// https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap

export const fonts = {
  /** Headings, code, mono UI elements, labels, badges, inputs */
  mono: "'JetBrains Mono', monospace",
  /** Body text, paragraphs, interface descriptions */
  sans: "'Plus Jakarta Sans', -apple-system, sans-serif",
} as const

// ─── Colors ──────────────────────────────────────────────────────────

export const colors = {
  // Backgrounds
  bg: '#ffffff',
  bgSubtle: '#f7f7f5',
  bgHover: '#f0f0ee',
  bgActive: '#e8e8e5',

  // Foreground / text
  fg: '#111111',
  fgSecondary: '#555555',
  fgMuted: '#999999',
  fgFaint: '#bbbbbb',

  // Borders
  border: '#e2e2df',
  borderStrong: '#d0d0cc',

  // Accent (warm copper)
  accent: '#c2682b',
  accentHover: '#a8571f',
  accentSubtle: '#fdf5ef',
  accentText: '#ffffff',

  // Semantic
  green: '#2d7d46',
  greenSubtle: '#eef7f0',
  red: '#c4342d',
  redSubtle: '#fdf0ef',
} as const

// ─── Radii ───────────────────────────────────────────────────────────

export const radii = {
  sm: '3px',
  default: '5px',
  lg: '8px',
} as const

// ─── Shadows ─────────────────────────────────────────────────────────

export const shadows = {
  sm: '0 1px 2px rgba(0,0,0,0.04)',
  default: '0 2px 8px rgba(0,0,0,0.06)',
  lg: '0 8px 30px rgba(0,0,0,0.08)',
} as const

// ─── Type scale ──────────────────────────────────────────────────────
// All headings use font-mono. Body text uses font-sans.

export const typeScale = {
  h1: { family: 'mono', size: '28px', weight: 600, letterSpacing: '-0.03em' },
  h2: { family: 'mono', size: '18px', weight: 600, letterSpacing: '-0.02em' },
  h3: { family: 'mono', size: '14px', weight: 600, letterSpacing: '-0.02em' },
  body: { family: 'sans', size: '14px', weight: 400, lineHeight: 1.5 },
  bodyLarge: { family: 'sans', size: '15px', weight: 400, lineHeight: 1.7 },
  label: {
    family: 'mono',
    size: '11px',
    weight: 500,
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
  },
  sectionHeader: {
    family: 'mono',
    size: '10.5px',
    weight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  badge: { family: 'mono', size: '10px', weight: 500, letterSpacing: '0.02em' },
  caption: { family: 'mono', size: '11px', weight: 400, letterSpacing: '-0.01em' },
  code: { family: 'mono', size: '13px', weight: 400 },
  nav: { family: 'sans', size: '13px', weight: 500, letterSpacing: '-0.01em' },
  button: { family: 'mono', size: '12.5px', weight: 500, letterSpacing: '-0.01em' },
  search: { family: 'mono', size: '12px', weight: 400 },
  pageTitle: { family: 'mono', size: '18px', weight: 600, letterSpacing: '-0.03em' },
  logo: { family: 'mono', size: '15px', weight: 600, letterSpacing: '-0.02em' },
} as const

// ─── Spacing reference ───────────────────────────────────────────────
// Not exported as values since Tailwind handles this, but documenting the conventions:
//
// Sidebar width: 260px
// Main content padding: 28px horizontal
// Editor content: 32px top, 48px horizontal, max-width 780px
// Doc row padding: 10px 12px
// Modal width: 420px
// Standard gaps: 8px (tight), 12px (normal), 16px (spacious)

// ─── CSS custom properties (for Tailwind v4 theme or global CSS) ─────

export const cssVariables = `
:root {
  --font-mono: 'JetBrains Mono', monospace;
  --font-sans: 'Plus Jakarta Sans', -apple-system, sans-serif;

  --bg: #ffffff;
  --bg-subtle: #f7f7f5;
  --bg-hover: #f0f0ee;
  --bg-active: #e8e8e5;

  --fg: #111111;
  --fg-secondary: #555555;
  --fg-muted: #999999;
  --fg-faint: #bbbbbb;

  --border: #e2e2df;
  --border-strong: #d0d0cc;

  --accent: #c2682b;
  --accent-hover: #a8571f;
  --accent-subtle: #fdf5ef;
  --accent-text: #ffffff;

  --green: #2d7d46;
  --green-subtle: #eef7f0;
  --red: #c4342d;
  --red-subtle: #fdf0ef;

  --radius-sm: 3px;
  --radius: 5px;
  --radius-lg: 8px;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow: 0 2px 8px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.08);
}
` as const
