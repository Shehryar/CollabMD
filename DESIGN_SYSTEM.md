# CollabMD Design System

Visual prototype: `design-prototype.html` (open in browser)
Code tokens: `packages/shared/src/design-system.ts` (importable from `@collabmd/shared`)

## Fonts

| Role | Family | Usage |
|------|--------|-------|
| Mono | JetBrains Mono | Headings, code, labels, badges, inputs, buttons, nav, logo |
| Sans | Plus Jakarta Sans | Body text, paragraphs, descriptions |

Google Fonts URL:
```
https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap
```

## Colors

### Backgrounds
| Token | Hex | Usage |
|-------|-----|-------|
| bg | `#ffffff` | Page background |
| bg-subtle | `#f7f7f5` | Sidebar, code blocks, subtle fills |
| bg-hover | `#f0f0ee` | Hover states |
| bg-active | `#e8e8e5` | Active/pressed states |

### Text
| Token | Hex | Usage |
|-------|-----|-------|
| fg | `#111111` | Primary text, headings |
| fg-secondary | `#555555` | Secondary text, descriptions |
| fg-muted | `#999999` | Muted labels, timestamps |
| fg-faint | `#bbbbbb` | Placeholders, disabled |

### Borders
| Token | Hex | Usage |
|-------|-----|-------|
| border | `#e2e2df` | Default borders, dividers |
| border-strong | `#d0d0cc` | Emphasized borders, button outlines |

### Accent (warm copper)
| Token | Hex | Usage |
|-------|-----|-------|
| accent | `#c2682b` | Primary accent, progress bars, inline code |
| accent-hover | `#a8571f` | Accent hover state |
| accent-subtle | `#fdf5ef` | Accent backgrounds (badges, avatars) |
| accent-text | `#ffffff` | Text on accent backgrounds |

### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| green | `#2d7d46` | Success, "agent edited" badge |
| green-subtle | `#eef7f0` | Green badge background |
| red | `#c4342d` | Error, "trashed" badge |
| red-subtle | `#fdf0ef` | Red badge background |

## Radii

| Token | Value |
|-------|-------|
| sm | 3px |
| default | 5px |
| lg | 8px |

## Shadows

| Token | Value |
|-------|-------|
| sm | `0 1px 2px rgba(0,0,0,0.04)` |
| default | `0 2px 8px rgba(0,0,0,0.06)` |
| lg | `0 8px 30px rgba(0,0,0,0.08)` |

## Type Scale

| Name | Font | Size | Weight | Spacing |
|------|------|------|--------|---------|
| h1 | mono | 28px | 600 | -0.03em |
| h2 | mono | 18px | 600 | -0.02em |
| h3 / modal title | mono | 14px | 600 | -0.02em |
| page title | mono | 18px | 600 | -0.03em |
| body | sans | 14px | 400 | 1.5 line-height |
| body large (editor) | sans | 15px | 400 | 1.7 line-height |
| nav item | sans | 13px | 500 | -0.01em |
| button | mono | 12.5px | 500 | -0.01em |
| label | mono | 11px | 500 | 0.02em uppercase |
| section header | mono | 10.5px | 500 | 0.06em uppercase |
| badge | mono | 10px | 500 | 0.02em |
| caption / meta | mono | 11px | 400 | -0.01em |
| code | mono | 13px | 400 | - |
| search | mono | 12px | 400 | - |
| logo | mono | 15px | 600 | -0.02em |

## Layout

| Element | Value |
|---------|-------|
| Sidebar width | 260px |
| Main header padding | 16px 28px |
| Editor content | 32px top, 48px sides, max-width 780px |
| Doc row padding | 10px 12px |
| Modal width | 420px |
| Standard gaps | 8px (tight), 12px (normal), 16px (spacious) |

## Buttons

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| Primary | `#111` (fg) | `#fff` (bg) | none |
| Secondary | `#fff` (bg) | `#111` (fg) | border-strong |
| Accent | `#c2682b` (accent) | `#fff` | none |
| New | `#fff` (bg) | `#111` (fg) | border-strong, inverts on hover |

All buttons: mono font, 12.5px, weight 500, 7px 16px padding, 5px radius.

## Badges

| Variant | Background | Text |
|---------|-----------|------|
| shared | accent-subtle | accent |
| agent edited | green-subtle | green |
| trashed | red-subtle | red |
| role (editor/viewer/owner) | bg | fg-secondary, 1px border |

All badges: mono font, 10px, weight 500, 2px 7px padding, 3px radius.

## Logo

Square mark: 22x22px, fg background, bg text, 3px radius, "#" character.
Wordmark: "collabmd" in mono font, 15px, weight 600.

## Design Principles

1. **Developer-native**: monospace everywhere it matters, code-like precision
2. **Warm neutrals**: off-white backgrounds (f7f7f5), warm borders (e2e2df), not cold gray
3. **Single accent**: copper (#c2682b) used sparingly for active states and emphasis
4. **Minimal chrome**: thin 1px borders, subtle shadows, content takes priority
5. **Tight typography**: negative letter-spacing on headings, compact line-heights on UI elements
