// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  registerShortcut,
  clearShortcuts,
  getRegisteredShortcuts,
  handleGlobalKeyDown,
  formatKeyCombo,
  isMacPlatform,
} from './keyboard-shortcuts'

afterEach(() => {
  clearShortcuts()
})

describe('registerShortcut', () => {
  it('adds shortcut to the registry', () => {
    registerShortcut({
      id: 'test',
      label: 'Test',
      category: 'navigation',
      keys: 'Mod-k',
      action: () => {},
    })
    expect(getRegisteredShortcuts()).toHaveLength(1)
    expect(getRegisteredShortcuts()[0].id).toBe('test')
  })

  it('returns an unregister function', () => {
    const unregister = registerShortcut({
      id: 'test',
      label: 'Test',
      category: 'navigation',
      keys: 'Mod-k',
      action: () => {},
    })
    expect(getRegisteredShortcuts()).toHaveLength(1)
    unregister()
    expect(getRegisteredShortcuts()).toHaveLength(0)
  })

  it('supports multiple registrations', () => {
    registerShortcut({
      id: 'a',
      label: 'A',
      category: 'navigation',
      keys: 'Mod-a',
      action: () => {},
    })
    registerShortcut({ id: 'b', label: 'B', category: 'document', keys: 'Mod-b', action: () => {} })
    expect(getRegisteredShortcuts()).toHaveLength(2)
  })
})

describe('clearShortcuts', () => {
  it('removes all registered shortcuts', () => {
    registerShortcut({
      id: 'a',
      label: 'A',
      category: 'navigation',
      keys: 'Mod-a',
      action: () => {},
    })
    registerShortcut({
      id: 'b',
      label: 'B',
      category: 'navigation',
      keys: 'Mod-b',
      action: () => {},
    })
    clearShortcuts()
    expect(getRegisteredShortcuts()).toHaveLength(0)
  })
})

describe('handleGlobalKeyDown', () => {
  it('calls matching shortcut action', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'test',
      label: 'Test',
      category: 'navigation',
      keys: 'Mod-k',
      action,
    })

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    handleGlobalKeyDown(event)
    expect(action).toHaveBeenCalledOnce()
  })

  it('prevents default on matching shortcut', () => {
    registerShortcut({
      id: 'test',
      label: 'Test',
      category: 'navigation',
      keys: 'Mod-s',
      action: () => {},
    })

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    const preventSpy = vi.spyOn(event, 'preventDefault')
    handleGlobalKeyDown(event)
    expect(preventSpy).toHaveBeenCalled()
  })

  it('does not call action when modifier does not match', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'test',
      label: 'Test',
      category: 'navigation',
      keys: 'Mod-k',
      action,
    })

    // No meta/ctrl key pressed
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      bubbles: true,
      cancelable: true,
    })
    handleGlobalKeyDown(event)
    expect(action).not.toHaveBeenCalled()
  })

  it('matches Shift modifier', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'test',
      label: 'Test',
      category: 'document',
      keys: 'Mod-Shift-h',
      action,
    })

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    handleGlobalKeyDown(event)
    expect(action).toHaveBeenCalledOnce()
  })

  it('does not match when Shift is required but not pressed', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'test',
      label: 'Test',
      category: 'document',
      keys: 'Mod-Shift-h',
      action,
    })

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      ctrlKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    })
    handleGlobalKeyDown(event)
    expect(action).not.toHaveBeenCalled()
  })

  it('matches backslash key for toggle sidebar', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'toggle-sidebar',
      label: 'Toggle sidebar',
      category: 'navigation',
      keys: 'Mod-\\',
      action,
    })

    const event = new KeyboardEvent('keydown', {
      key: '\\',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    handleGlobalKeyDown(event)
    expect(action).toHaveBeenCalledOnce()
  })

  it('matches forward slash key for help', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'help',
      label: 'Help',
      category: 'navigation',
      keys: 'Mod-/',
      action,
    })

    const event = new KeyboardEvent('keydown', {
      key: '/',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    handleGlobalKeyDown(event)
    expect(action).toHaveBeenCalledOnce()
  })

  it('skips editor shortcuts when target is an input', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'editor-shortcut',
      label: 'Focus editor',
      category: 'editor',
      keys: 'Mod-Shift-e',
      action,
    })

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', {
      key: 'e',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    // Dispatch on the input element
    Object.defineProperty(event, 'target', { value: input })
    handleGlobalKeyDown(event)
    expect(action).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it('allows navigation shortcuts in inputs', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'nav-shortcut',
      label: 'Command palette',
      category: 'navigation',
      keys: 'Mod-k',
      action,
    })

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'target', { value: input })
    handleGlobalKeyDown(event)
    expect(action).toHaveBeenCalledOnce()

    document.body.removeChild(input)
  })

  it('skips handling when another listener already prevented the event', () => {
    const action = vi.fn()
    registerShortcut({
      id: 'open-history',
      label: 'Version history',
      category: 'document',
      keys: 'Mod-Shift-h',
      action,
    })

    const event = new KeyboardEvent('keydown', {
      key: 'h',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()

    handleGlobalKeyDown(event)
    expect(action).not.toHaveBeenCalled()
  })
})

describe('formatKeyCombo', () => {
  // jsdom doesn't define navigator.platform as Mac, so this tests the non-Mac path
  it('formats Mod as Ctrl on non-Mac', () => {
    const result = formatKeyCombo('Mod-k')
    expect(result).toBe('Ctrl+k')
  })

  it('formats Shift as Shift on non-Mac', () => {
    const result = formatKeyCombo('Mod-Shift-s')
    expect(result).toBe('Ctrl+Shift+s')
  })

  it('formats Alt as Alt on non-Mac', () => {
    const result = formatKeyCombo('Mod-Alt-c')
    expect(result).toBe('Ctrl+Alt+c')
  })
})

describe('isMacPlatform', () => {
  it('returns false in jsdom (no Mac user agent)', () => {
    expect(isMacPlatform()).toBe(false)
  })
})
