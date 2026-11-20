import { equal } from "node:assert/strict";
import { test } from "node:test";
import { EditorState, Transaction } from "@codemirror/state";
import { compactLinesField, setCompactLines } from "../src/compact-lines";

void test("reveals the active caption range and keeps a separate caption compact", () => {
  let state = EditorState.create({ doc: "image\n\nfence\ncontent\nend\nimage\n\nfence\ncontent\nend", extensions: [compactLinesField] });
  const line = (number: number) => state.doc.line(number);
  state = state.update({
    effects: setCompactLines.of([
      { from: line(2).from, to: line(5).to, lines: [line(2).from, line(3).from] },
      { from: line(7).from, to: line(10).to, lines: [line(7).from] }
    ]),
    annotations: Transaction.addToHistory.of(false)
  }).state;
  equal(state.field(compactLinesField).marks.size, 3);

  state = state.update({ selection: { anchor: line(2).from } }).state;
  equal(state.field(compactLinesField).marks.size, 1);

  state = state.update({ selection: { anchor: line(2).from, head: line(7).from } }).state;
  equal(state.field(compactLinesField).marks.size, 0);

  state = state.update({ selection: { anchor: 0 } }).state;
  equal(state.field(compactLinesField).marks.size, 3);
});

void test("drops positions from the previous document on editing", () => {
  let state = EditorState.create({ doc: "abcd", extensions: [compactLinesField] });
  state = state.update({
    effects: setCompactLines.of([{ from: 1, to: 3, lines: [1] }])
  }).state;

  state = state.update({ changes: { from: 0, to: 2 } }).state;
  equal(state.field(compactLinesField).marks.size, 0);
  equal(state.field(compactLinesField).groups.length, 0);
});
