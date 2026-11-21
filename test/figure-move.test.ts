import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { EditorState, Text } from "@codemirror/state";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { imageMovesWithChange, moveFigure, type FigureMove } from "../src/figure-move";
import { figureAtCaptionOrMarker, figureIndex } from "../src/figure-source";
import { parseDocument } from "../src/markdown-source";

const opening = '<!-- live-image-figure:v1 {"crop":{"x":0.1,"y":0.2,"width":0.7,"height":0.4},"layout":{"extra":true}} -->';
const closing = "<!-- /live-image-figure -->";
const image = "![[photo.png|191]] ^test-image";
const raw = [opening, image, "", "- Caption **main**", "\t- Nested", "- Last", "", closing];
const indent = (rows: string[], prefix: string) => rows.map((line, i) => line ? prefix + line : i === 2 ? prefix.slice(0, 1) : line);
const doc = (lines: string[]) => Text.of(lines);
const shape = doc(["- Root parent", "\t- Duplicate", "\t- Duplicate", ...indent(raw, "\t\t"), "\t- Remaining child", "", "![[photo.png|191]]"]);

function first(text: Text) {
  const figure = figureIndex(text).figures[0];
  ok(figure);
  return figure;
}

void test("only the caption and its marker lines activate boundary reveal in a figure", () => {
  const figure = first(shape);
  const body = shape.lineAt(figure.image.from).number + 1;
  for (const position of [figure.opening.from, shape.line(body).to, shape.line(body + 1).from, figure.closing.to]) {
    equal(figureAtCaptionOrMarker(shape, position), figure);
  }
  for (const position of [figure.image.from, figure.image.to, shape.lineAt(figure.image.to).to, figure.closing.to + 1]) {
    equal(figureAtCaptionOrMarker(shape, position), undefined);
  }
});

void test("promotes a continuation twice, keeps its neighbors, and preserves native selection and exact inverse edits", () => {
  const root = first(shape);
  let state = EditorState.create({ doc: shape, selection: { anchor: root.image.from }, extensions: history() });
  const inverses: FigureMove[] = [];
  for (const parent of ["ListItem", "Document"]) {
    const old = state.doc;
    const selected = first(old);
    const move = moveFigure(old, selected, "up", "\t");
    ok(move);
    ok(imageMovesWithChange(selected.image.from, selected.image.to, move));
    inverses.push({ changes: move.changes.invert(old), imageFrom: selected.image.from, imageTo: selected.image.to });
    state = state.update({ changes: move.changes, annotations: isolateHistory.of("full") }).state;
    const relocated = first(state.doc);
    equal(state.selection.main.head, relocated.image.from);
    equal(relocated.owner.name, parent);
    deepEqual(relocated.metadata, root.metadata);
    ok(state.doc.toString().includes("\t- Duplicate\n\t- Duplicate\n"));
    equal(state.doc.lineAt(relocated.image.from).text.trim(), image);
  }
  equal(moveFigure(state.doc, first(state.doc), "up"), undefined);
  const top = state.doc.toString();
  ok(top.indexOf("\t- Remaining child") < top.indexOf(opening));
  for (const reverse of inverses.reverse()) {
    const current = first(state.doc);
    ok(imageMovesWithChange(current.image.from, current.image.to, reverse));
    state = state.update({ changes: reverse.changes, annotations: isolateHistory.of("full") }).state;
    equal(state.selection.main.head, reverse.imageFrom);
  }
  equal(state.doc.toString(), shape.toString());
  const target = { get state() { return state; }, dispatch: (tr: ReturnType<EditorState["update"]>) => { state = tr.state; } };
  ok(undo(target));
  ok(undo(target));
  equal(state.doc.toString(), top);
  ok(redo(target));
  ok(redo(target));
  equal(state.doc.toString(), shape.toString());
});

void test("moves around a parent's later content rather than promoting that content accidentally", () => {
  const current = doc(["- Parent", ...indent(raw, "  "), "", "  Follow-up paragraph.", "", "  - Actual child", "- Next"]);
  const change = moveFigure(current, first(current), "up");
  ok(change);
  const result = change.changes.apply(current);
  const moved = first(result);
  equal(moved.owner.name, "Document");
  const following = result.toString().indexOf("  Follow-up paragraph.");
  const actualChild = result.toString().indexOf("  - Actual child");
  ok(following < moved.from && actualChild < moved.from);
  const next = result.toString().indexOf("- Next");
  ok(next > moved.to);
  equal(parseDocument(result).resolveInner(following + 2, 1).parent?.name, "ListItem");
});

void test("indents under the adjacent legal item and moves a standalone figure without taking its siblings", () => {
  const current = doc(["- Parent", "  - Previous", "  - " + opening, ...indent(raw.slice(1), "    "), "  - Following"]);
  const item = first(current);
  ok(item.ownsBullet);
  const inward = moveFigure(current, item, "down");
  ok(inward);
  const moved = inward.changes.apply(current);
  ok(moved.toString().includes("    - " + opening));
  ok(moved.toString().endsWith("  - Following"));
  const outward = moveFigure(current, item, "up");
  ok(outward);
  const up = outward.changes.apply(current);
  ok(up.toString().includes("  - Following\n- " + opening));
  equal(moveFigure(up, first(up), "up"), undefined);
});

void test("does not infer a target across text, an empty bullet or unrelated content in its own item", () => {
  for (const lines of [["- Parent", "", "Boundary paragraph.", "", ...raw], ["- ", "", ...raw]]) {
    const text = doc(lines);
    equal(moveFigure(text, first(text), "down"), undefined);
  }
  const mixed = doc(["- Parent", "  - " + opening, ...indent(raw.slice(1), "    "), "    Child paragraph."]);
  equal(moveFigure(mixed, first(mixed), "up"), undefined);
});
