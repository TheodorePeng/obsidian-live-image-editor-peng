import { StateEffect, StateField, type SelectionRange } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface CompactLines {
  from: number;
  to: number;
  lines: number[];
}

export const setCompactLines = StateEffect.define<readonly CompactLines[]>();

const compactLine = Decoration.line({ class: "image-caption-peng--compact-line" });

function decorations(groups: readonly CompactLines[], selection: readonly SelectionRange[]): DecorationSet {
  const ranges = groups.flatMap(group => {
    if (selection.some(range => range.from <= group.to && range.to >= group.from)) return [];
    return group.lines.map(line => compactLine.range(line));
  });
  return Decoration.set(ranges, true);
}

export const compactLinesField = StateField.define({
  create(): { groups: readonly CompactLines[]; marks: DecorationSet } {
    return { groups: [], marks: Decoration.none };
  },
  update(current, transaction) {
    let groups = transaction.docChanged ? [] : current.groups;
    for (const effect of transaction.effects) {
      if (effect.is(setCompactLines)) groups = effect.value;
    }
    if (groups === current.groups && !transaction.selection) return current;
    return { groups, marks: decorations(groups, transaction.newSelection.ranges) };
  },
  provide: field => EditorView.decorations.from(field, value => value.marks)
});
