/**
 * App-level keyboard shortcut system for CollabMD.
 *
 * Shortcuts are registered via a central registry and dispatched by
 * a global keydown listener mounted once at the app layout level.
 */

export interface ShortcutDef {
  /** Internal id, e.g. "toggle-sidebar" */
  id: string
  /** Human-readable label shown in help panel and command palette */
  label: string
  /** Category for grouping in the help panel */
  category: 'editor' | 'navigation' | 'document' | 'collaboration'
  /** Key combo string, e.g. "Mod-k". Mod = Cmd on Mac, Ctrl elsewhere. */
  keys: string
  /** Action to run. Return true if handled. */
  action: () => boolean | void
}

// Platform helpers ---

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform)
}

/**
 * Formats a key combo for display.
 * Converts "Mod" to the platform modifier symbol.
 */
export function formatKeyCombo(keys: string): string {
  const mac = isMacPlatform()
  return keys
    .replace(/Mod/g, mac ? '\u2318' : 'Ctrl')
    .replace(/Shift/g, mac ? '\u21E7' : 'Shift')
    .replace(/Alt/g, mac ? '\u2325' : 'Alt')
    .replace(/-/g, mac ? '' : '+')
}

// Registry ---

const registry: ShortcutDef[] = []

export function registerShortcut(def: ShortcutDef): () => void {
  registry.push(def)
  return () => {
    const idx = registry.indexOf(def)
    if (idx >= 0) registry.splice(idx, 1)
  }
}

export function getRegisteredShortcuts(): readonly ShortcutDef[] {
  return registry
}

export function clearShortcuts(): void {
  registry.length = 0
}

// Matching ---

function parseKeyCombo(keys: string): { mod: boolean; shift: boolean; alt: boolean; key: string } {
  const parts = keys.split('-')
  const mod = parts.includes('Mod')
  const shift = parts.includes('Shift')
  const alt = parts.includes('Alt')
  const key = parts[parts.length - 1].toLowerCase()
  return { mod, shift, alt, key }
}

function matchesEvent(event: KeyboardEvent, keys: string): boolean {
  const combo = parseKeyCombo(keys)
  const mac = isMacPlatform()

  const modPressed = mac ? event.metaKey : event.ctrlKey
  if (combo.mod !== modPressed) return false
  if (combo.shift !== event.shiftKey) return false
  if (combo.alt !== event.altKey) return false

  const eventKey = event.key.toLowerCase()

  // Handle special key names
  if (combo.key === '\\' && eventKey === '\\') return true
  if (combo.key === '.' && eventKey === '.') return true
  if (combo.key === '/' && eventKey === '/') return true

  return eventKey === combo.key
}

// --- Command palette filtering ---

export interface CommandItem {
  id: string
  label: string
  category: string
  shortcut?: string
  action: () => void
}

export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  if (!query.trim()) return items
  const lower = query.toLowerCase()
  return items.filter((item) => item.label.toLowerCase().includes(lower))
}

/**
 * Global keydown handler. Attach to document once at the app layout level.
 */
export function handleGlobalKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return

  // Don't intercept when the target is an input/textarea/select (unless it's a global shortcut)
  const target = event.target as HTMLElement | null
  const isInput =
    target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'

  for (const def of registry) {
    if (!matchesEvent(event, def.keys)) continue

    // For input elements, only allow navigation/document shortcuts (not editor ones)
    if (isInput && def.category === 'editor') continue

    event.preventDefault()
    event.stopPropagation()
    def.action()
    return
  }
}
