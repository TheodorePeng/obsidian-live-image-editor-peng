import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { figureAtCaptionOrMarker, figureIndex } from "./figure-source";

interface FigureState {
  enabled: boolean;
  reveal?: number;
  decorations: DecorationSet;
}

export const figureContext = StateEffect.define<boolean>();

const hideComment = Decoration.replace({});
const hideRow = Decoration.line({ class: "image-caption-peng--native-marker" });
const emptyBoundary = Decoration.line({ class: "image-caption-peng--empty-boundary" });

export const figureExtension = StateField.define<FigureState>({
  create: () => ({ enabled: false, decorations: Decoration.none }),
  update(previous, transaction) {
    let { enabled } = previous;
    for (const effect of transaction.effects) {
      if (effect.is(figureContext)) enabled = effect.value;
    }
    const { state } = transaction;
    const live = state.field(editorLivePreviewField, false) === true;
    if (!enabled || !live) return { enabled, decorations: Decoration.none };
    if (!transaction.docChanged && !transaction.selection && enabled === previous.enabled &&
        transaction.startState.field(editorLivePreviewField, false) === live) return previous;
    const { doc, selection } = state;
    const active = figureAtCaptionOrMarker(doc, selection.main.head);
    const reveal = active?.from;
    if (!transaction.docChanged && reveal === previous.reveal && enabled === previous.enabled &&
        transaction.startState.field(editorLivePreviewField, false) === live) return previous;
    const figures = figureIndex(doc).figures;
    const ranges = [];
    for (const figure of figures) {
      if (figure.from === reveal) continue;
      const open = doc.lineAt(figure.opening.from);
      const close = doc.lineAt(figure.closing.from);
      const image = doc.lineAt(figure.image.from);
      const hasCaptionRow = close.number > image.number + 1;
      ranges.push(hideComment.range(figure.opening.from, figure.opening.to));
      ranges.push(hideComment.range(figure.closing.from, figure.closing.to));
      if (!figure.ownsBullet) ranges.push(hideRow.range(open.from));
      ranges.push((hasCaptionRow ? hideRow : emptyBoundary).range(close.from));
    }
    return { enabled, reveal, decorations: Decoration.set(ranges, true) };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations)
});
