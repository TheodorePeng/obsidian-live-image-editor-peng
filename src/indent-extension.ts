import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { synchronizeCaptionIndent, type IndentDirection } from "./caption-indent";

export function captionIndentExtension(): Extension {
  const intents = new WeakMap<EditorState, { direction: IndentDirection }>();
  const listen = ViewPlugin.fromClass(class {
    constructor(private readonly view: EditorView) {
      view.dom.addEventListener("keydown", this.keydown, true);
    }

    destroy(): void {
      this.view.dom.removeEventListener("keydown", this.keydown, true);
      intents.delete(this.view.state);
    }

    private readonly keydown = (event: KeyboardEvent): void => {
      const { state, contentDOM, composing } = this.view;
      if (event.key !== "Tab" || event.defaultPrevented || event.isComposing || composing ||
          event.altKey || event.metaKey || event.ctrlKey || state.readOnly ||
          !contentDOM.contains(event.targetNode) || state.field(editorLivePreviewField, false) !== true) return;
      const intent: { direction: IndentDirection } = { direction: event.shiftKey ? -1 : 1 };
      intents.set(state, intent);
      // Only the native editor transaction from this key event may use this intent.
      // A trusted key event can flush microtasks between capture and the native keymap.
      this.view.dom.win.setTimeout(() => {
        if (intents.get(state) === intent) intents.delete(state);
      });
    };
  });

  return [listen, EditorState.transactionFilter.of(transaction => {
    const intent = intents.get(transaction.startState);
    if (!intent || !transaction.isUserEvent(intent.direction === 1 ? "input.indent" : "delete.dedent")) {
      return transaction;
    }
    return synchronizeCaptionIndent(transaction, intent.direction);
  })];
}
