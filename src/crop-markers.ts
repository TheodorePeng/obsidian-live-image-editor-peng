import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { imageReferences } from "./image-source";
import { isLocalImageTarget } from "./image-target";

function decorations(state: EditorState) {
  if (!state.field(editorLivePreviewField, false)) return Decoration.none;
  const ranges = [];
  for (const { marker, target } of imageReferences(state.doc).references) {
    if (!marker?.crop || !isLocalImageTarget(target)) continue;
    const line = state.doc.lineAt(marker.from);
    if (state.selection.ranges.some(range => range.from <= line.to && range.to >= line.from)) continue;
    ranges.push(Decoration.replace({}).range(marker.from, marker.to));
  }
  return Decoration.set(ranges);
}

export const cropMarkers = StateField.define({
  create: decorations,
  update(current, transaction) {
    if (transaction.docChanged || transaction.selection || transaction.reconfigured ||
        transaction.startState.field(editorLivePreviewField, false) !== transaction.state.field(editorLivePreviewField, false)) {
      return decorations(transaction.state);
    }
    return current;
  },
  provide: field => EditorView.decorations.from(field)
});
