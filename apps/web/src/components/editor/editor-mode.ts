import { Compartment, StateEffect, StateField } from '@codemirror/state'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export type EditorMode = 'editing' | 'suggesting' | 'viewing'

export const setEditorModeEffect = StateEffect.define<EditorMode>()

export const editorModeField = StateField.define<EditorMode>({
  create() {
    return 'editing'
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorModeEffect)) {
        return effect.value
      }
    }
    return value
  },
})

export const editableCompartment = new Compartment()
export const readOnlyCompartment = new Compartment()

export function editableExtensionsForMode(mode: EditorMode): {
  editable: Extension
  readOnly: Extension
} {
  if (mode === 'viewing') {
    return {
      editable: EditorView.editable.of(false),
      readOnly: EditorState.readOnly.of(true),
    }
  }
  return {
    editable: EditorView.editable.of(true),
    readOnly: EditorState.readOnly.of(false),
  }
}

export function dispatchModeChange(view: EditorView, mode: EditorMode): void {
  const extensions = editableExtensionsForMode(mode)
  view.dispatch({
    effects: [
      setEditorModeEffect.of(mode),
      editableCompartment.reconfigure(extensions.editable),
      readOnlyCompartment.reconfigure(extensions.readOnly),
    ],
  })
}
