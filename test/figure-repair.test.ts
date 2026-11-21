import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, Text } from "@codemirror/state";
import { figureSourceSpan, repairFigure } from "../src/figure-repair";
import { figureIndex, type Span } from "../src/figure-source";

const opening = '<!-- live-image-figure:v1 {"crop":{"x":0.1,"y":0.2,"width":0.5,"height":0.4}} -->';
const closing = "<!-- /live-image-figure -->";
const image = "![[test.png|203]]";
const before = ["- Root", "\t- Sibling before", "\t- 666"];
const after = ["\t- Sibling after", "", "Tail"];
const base = "\t\t";
const caption = ["Intro with [[Link]].", "", "- a", "\t- b", "", "    example", "", "> quote"];
const body = [opening, image, "", ...caption, "", closing];
function indent(rows: string[], prefix = base): string[] {
  return rows.map(row => row ? prefix + row : row);
}

function replaceRow(rows: string[], index: number, text: string): string[] {
  return rows.map((row, i) => i === index ? text : row);
}

function fixture(list: string[]) {
  const doc = Text.of([...before, ...list, ...after]);
  return { doc, from: doc.line(before.length + 1).from, to: doc.line(before.length + list.length).to };
}

function fixed(doc: Text, span: Span) {
  const repair = repairFigure(doc, span.from, span.to);
  ok("changes" in repair, "message" in repair ? repair.message : "");
  return repair;
}

void test("selects exactly one source figure in valid and recoverable Markdown with repeated attachment targets", () => {
  const valid = fixture(indent(body));
  const next = Text.of([...valid.doc.toString().split("\n"), "", ...body]);
  const cursor = next.line(5).from;
  const selected = figureSourceSpan(next, cursor);
  ok(selected);
  equal(next.sliceString(selected.from, selected.to), indent(body).join("\n"));
  equal(figureSourceSpan(next, selected.from + base.length, selected.to + 1)?.from, selected.from);
  equal(figureSourceSpan(next, selected.from, next.length), undefined);
  const bad = fixture(replaceRow(indent(body), 1, "\t\t\t" + image));
  equal(figureSourceSpan(bad.doc, bad.doc.line(5).from)?.from, bad.from);
});

void test("reanchors a shifted image or closing marker, preserving rich caption, crop and outside text", () => {
  const expected = fixture(indent(body));
  for (const bad of [replaceRow(indent(body), 1, "\t\t\t" + image), replaceRow(indent(body), body.length - 1, "\t" + closing)]) {
    const original = fixture(bad);
    const repair = fixed(original.doc, original);
    equal(repair.changes.apply(original.doc).toString(), expected.doc.toString());
    equal(repair.span.to, expected.to);
  }
});

void test("preserves authored tab-only blank rows when repairing the image indent", () => {
  const whitespace = replaceRow(indent(body), 2, "\t");
  const original = fixture(replaceRow(whitespace, 1, "\t\t\t" + image));
  equal(fixed(original.doc, original).changes.apply(original.doc).toString(), fixture(whitespace).doc.toString());
});

void test("uses the new opener position and rebases the rest of a figure as one undo step", () => {
  const expected = fixture(indent(body));
  const old = fixture(replaceRow(indent(body, "\t\t\t"), 0, base + opening));
  const result = fixed(old.doc, old);
  let state = EditorState.create({ doc: old.doc, selection: { anchor: old.to, head: old.from }, extensions: history() });
  state = state.update({ changes: result.changes, selection: { anchor: result.span.to, head: result.span.from },
    annotations: isolateHistory.of("full") }).state;
  equal(state.doc.toString(), expected.doc.toString());
  equal(state.selection.main.anchor, expected.to);
  const target = { get state() { return state; }, dispatch: (tr: ReturnType<EditorState["update"]>) => { state = tr.state; } };
  ok(undo(target));
  equal(state.doc.toString(), old.doc.toString());
  ok(redo(target));
  equal(state.doc.toString(), expected.doc.toString());
});

void test("fixes an unambiguously outdented plain paragraph and preserves literal marker examples in fences", () => {
  const source = [opening, image, "", "Outdented [[Link]].", "", closing];
  const broken = fixture(replaceRow(indent(source), 3, "\tOutdented [[Link]]."));
  equal(fixed(broken.doc, broken).changes.apply(broken.doc).toString(), fixture(indent(source)).doc.toString());
  const fenced = [opening, image, "", "```md", opening, closing, "```", "", closing];
  const mixed = fixture(replaceRow(indent(fenced), 1, base + "    " + image));
  const repaired = fixed(mixed.doc, mixed).changes.apply(mixed.doc);
  equal(repaired.toString(), fixture(indent(fenced)).doc.toString());
  equal(figureIndex(repaired).figures.length, 1);
});

void test("preserves source when selection has multiple figures, extra text, broken boundary or ambiguous structure", () => {
  for (const original of [
    fixture([...indent(body), "", ...indent(body)]),
    fixture([...indent(body), "Ordinary prose."]),
    fixture(indent(body).slice(0, -1)),
    fixture(replaceRow(indent(body), 0, base + opening.replace(":v1", ":v2"))),
    fixture(replaceRow(indent(body), 1, base + image + " " + image)),
    fixture(replaceRow(indent(body), 4, "- a")),
    fixture(["\t\t```md", ...indent(body), "\t\t```"])
  ]) {
    ok("message" in repairFigure(original.doc, original.from, original.to), original.doc.toString());
  }
});
