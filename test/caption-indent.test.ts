import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type ChangeSpec, type Transaction } from "@codemirror/state";
import { synchronizeCaptionIndent, type IndentDirection } from "../src/caption-indent";
import { captionIndex } from "../src/caption-source";

const fence = "```";
const rich = ["**Caption** [[Statics]]", "", "- Point", "  1. Detail", "", "$$", "M = FL/4", "$$"];
const caption = (indent: string, body = rich) =>
  [indent + fence + "image-caption", ...body.map(line => line ? indent + line : ""), indent + fence];

function create(lines: string[], imageLine: number, direction: IndentDirection, multi = false) {
  const start = lines.slice(0, imageLine - 1).reduce((offset, line) => offset + line.length + 1, 0);
  const anchor = start + lines[imageLine - 1].indexOf("![");
  return EditorState.create({
    doc: lines.join("\n"),
    selection: multi
      ? EditorSelection.create([EditorSelection.cursor(anchor), EditorSelection.cursor(0)])
      : EditorSelection.single(anchor, start + lines[imageLine - 1].length),
    extensions: [
      EditorState.allowMultipleSelections.of(multi),
      history(),
      EditorState.transactionFilter.of(transaction => synchronizeCaptionIndent(transaction, direction))
    ]
  });
}

function changeIndent(state: EditorState, lines: number[], remove: number, insert = "", event = "delete"): Transaction {
  const changes: ChangeSpec[] = lines.map(number => {
    const line = state.doc.line(number);
    const indent = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;
    return { from: line.from, to: line.from + Math.min(indent, remove), insert };
  });
  return state.update({ changes, userEvent: event });
}

function bodyAt(state: EditorState, imageLine: number): string | undefined {
  const index = captionIndex(state.doc);
  const image = index.images.get(imageLine);
  return image && index.captionedImages.get(image.from)?.body;
}

void test("repairs the native outdent in one transaction and preserves rich Markdown, selection and separate native changes", () => {
  const original = ["- Parent", "  - ![[same.png]]", "", ...caption("    "), "", "    Unrelated"];
  const state = create(original, 2, -1);
  const transaction = changeIndent(state, [2, ...caption("    ").map((_, i) => i + 4), original.length], 4);
  const expected = ["- Parent", "- ![[same.png]]", "", ...caption("  "), "", "Unrelated"].join("\n");
  equal(transaction.newDoc.toString(), expected);
  equal(bodyAt(transaction.state, 2), rich.join("\n"));
  const selected = transaction.state.selection.main;
  equal(transaction.newDoc.sliceString(selected.from, selected.to), "![[same.png]]");

  let current = transaction.state;
  const dispatch = (step: Transaction) => { current = step.state; };
  ok(undo({ state: current, dispatch }));
  equal(current.doc.toString(), original.join("\n"));
  ok(!undo({ state: current, dispatch }));
  ok(redo({ state: current, dispatch }));
  equal(current.doc.toString(), expected);
});

void test("keeps the complete native indent when the image and its empty fence already stay together", () => {
  const lines = ["- Parent", "  - Previous", "  - ![[same.png]]", "", ...caption("    ", [""]), "", "---"];
  const state = create(lines, 3, 1);
  const transaction = changeIndent(state, [3, 4, 5, 6, 7], 0, "\t", "input.indent");
  const expected = lines.map((line, i) => i >= 2 && i <= 6 ? "\t" + line : line).join("\n");
  equal(transaction.newDoc.toString(), expected);
  equal(bodyAt(transaction.state, 3), "");
});

void test("reparents an unmarked continuation when native outdent gives it a valid list owner", () => {
  const lines = [
    "- Outer", "  - Inner", "    - Detail", "", "      ![beam](beam.png)", "", ...caption("      "),
    "", "- ![[same.png]]", "", ...caption("  ", ["Another caption"])
  ];
  const state = create(lines, 5, -1);
  const transaction = changeIndent(state, [5], 4);
  const expected = lines.map((line, i) => i === 4 || (i >= 6 && i < 6 + caption("      ").length)
    ? line.slice(4) : line);
  equal(transaction.newDoc.toString(), expected.join("\n"));
  equal(bodyAt(transaction.state, 5), rich.join("\n"));
  equal(bodyAt(transaction.state, lines.indexOf("- ![[same.png]]") + 1), "Another caption");
});

void test("keeps the original pair when native continuation movement would lose the list or become code", () => {
  const lines = ["- Parent", "  - Detail", "", "    ![[same.png]]", "", ...caption("    ")];
  const out = create(lines, 4, -1);
  const indent = create(lines, 4, 1);
  equal(changeIndent(out, [4], 4).docChanged, false);
  equal(changeIndent(indent, [4], 0, "\t", "input.indent").docChanged, false);
});

void test("preserves relative Markdown indentation in mixed tab and space prefixes", () => {
  const lines = ["- Parent", "\t- ![[same.png]]", "", "\t  " + fence + "image-caption",
    "\t  - Point", "\t\t1. Detail", "\t  " + fence];
  const state = create(lines, 2, -1);
  const transaction = changeIndent(state, [2, 4, 5, 6, 7], 8);
  equal(transaction.newDoc.toString(), ["- Parent", "- ![[same.png]]", "", "  " + fence + "image-caption",
    "  - Point", "    1. Detail", "  " + fence].join("\n"));
  equal(bodyAt(transaction.state, 2), "- Point\n  1. Detail");
});

void test("leaves native behavior for plain images, ordered lists, unfinished fences and multiple selections", () => {
  const cases = [
    { lines: ["- Parent", "  - ![[same.png]]"], multi: false },
    { lines: ["- Parent", "  1. ![[same.png]]", "", ...caption("     ")], multi: false },
    { lines: ["- Parent", "  - ![[same.png]]", "", "    " + fence + "image-caption", "    Draft"], multi: false },
    { lines: ["- Parent", "  - ![[same.png]]", "", ...caption("    ")], multi: true }
  ];
  for (const { lines, multi } of cases) {
    const transaction = changeIndent(create(lines, 2, -1, multi), [2], 2);
    deepEqual(transaction.newDoc.toString().split("\n"), [lines[0], lines[1].slice(2), ...lines.slice(2)]);
  }
});

void test("does not interfere with multi-line selection, non-indent changes or history events", () => {
  const lines = ["- Parent", "  - ![[same.png]]", "", ...caption("    "), "", "Another item"];
  const state = create(lines, 2, -1);
  const image = state.doc.line(2);
  const changed = state.update({ changes: [{ from: image.from, to: image.from + 2 }, { from: image.to, insert: " text" }], userEvent: "delete" });
  equal(changed.newDoc.line(2).text, "- ![[same.png]] text");
  const wide = state.update({ selection: { anchor: image.from, head: state.doc.line(3).from } }).state;
  equal(changeIndent(wide, [2], 2).newDoc.line(4).text, lines[3]);
  equal(changeIndent(state, [2], 2, "", "undo").newDoc.line(4).text, lines[3]);
});
