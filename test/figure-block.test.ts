import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, Text } from "@codemirror/state";
import { canWrapImage, captionCursor, changeCrop, createCaptionRow, wrapImage, type FigureChange } from "../src/figure-change";
import { figureClose, figureIndex, formatOpening, type Figure } from "../src/figure-source";
import { imageReferences } from "../src/image-source";

const starter = formatOpening({});
const image = "![[photo.png|204]]";
const crop = { x: .25, y: .25, width: .5, height: .25 };
const document = (source: string) => Text.of(source.split("\n"));

function figure(doc: Text): Figure {
  const value = figureIndex(doc).figures[0];
  ok(value);
  return value;
}

function patch(doc: Text, change: FigureChange | undefined): Text {
  ok(change);
  return doc.replace(change.from, change.to, document(change.insert));
}

function block(picture = image, caption = "A **caption**.", metadata = {}) {
  return [formatOpening(metadata), picture, "", caption, "", figureClose].join("\n");
}

function indent(source: string, size = 2) {
  return source.split("\n").map(line => line ? " ".repeat(size) + line : line).join("\n");
}

void test("parses complete figures as native Markdown with exact ranges and per-occurrence metadata", () => {
  const doc = document(block(image + " ^image-block", "First **caption**.\n\nSecond with [[Link]].", { crop }) +
    "\n\n" + block(image, "Different caption."));
  const [a, b] = figureIndex(doc).figures;
  ok(a && b);
  equal(doc.sliceString(a.opening.from, a.opening.to), formatOpening({ crop }));
  equal(doc.sliceString(a.image.from, a.image.to), image);
  equal(doc.sliceString(a.closing.from, a.closing.to), figureClose);
  equal(a.caption, "First **caption**.\n\nSecond with [[Link]].");
  deepEqual(a.crop, [.25, .25, .5, .25]);
  equal(b.caption, "Different caption.");
  equal(b.crop, undefined);
  equal(b.image.target, a.image.target);
});

void test("uses explicit list ownership for a continuation and a standalone child bullet", () => {
  const continuation = figure(document("- Title\n\n" + indent(block()) + "\n- Next"));
  equal(continuation.indent, 2);
  equal(continuation.ownsBullet, false);
  const child = figure(document("- Title\n  - " + starter + "\n    " + image + "\n    " + figureClose + "\n  - Next"));
  equal(child.indent, 4);
  equal(child.ownsBullet, true);
});

void test("keeps different-version, malformed, nested and out-of-container syntax native", () => {
  const samples = [
    block().replace(":v1", ":v2"),
    block(image, "", { crop: { ...crop, width: .8 } }),
    block().replace(starter, '<!-- live-image-figure:v1 {"crop":} -->'),
    block().replace(figureClose, ""),
    "- " + starter + "\n  " + image + "\n- " + figureClose,
    block(image + " " + image),
    block().replace(starter, starter + "\n" + starter),
    "> [!tip]\n" + block().split("\n").map(row => "> " + row).join("\n"),
    "```md\n" + block() + "\n```",
    "<!-- vml -->\n" + block() + "\n<!-- /vml -->",
    "%%\n" + block() + "\n%%"
  ];
  for (const sample of samples) {
    const doc = document(sample);
    equal(figureIndex(doc).figures.length, 0, sample);
    for (const ref of imageReferences(doc).references) equal(canWrapImage(doc, ref), false, sample);
  }
});

void test("keeps look-alike markers in literal Markdown caption fences", () => {
  const caption = "```md\n" + figureClose + "\n```";
  equal(figure(document(block(image, caption))).caption, caption);
});

void test("localizes edits without losing alt, title, block ID, and future JSON keys", () => {
  const embed = '![Alt\\] text|204x70](<assets/beam sketch.png> "Title")';
  const info = { crop: { ...crop, extra: true }, layout: { captionPosition: "right" }, custom: "-->" };
  const initial = document(block(embed + " ^image-block", "Original.", info) + "\n\nUnrelated.");
  const start = figure(initial);
  const cropped = patch(initial, changeCrop(start, [.1, .2, .3, .4]));
  deepEqual(figure(cropped).metadata, { ...info, crop: { x: .1, y: .2, width: .3, height: .4, extra: true } });
  const restored = patch(cropped, changeCrop(figure(cropped)));
  deepEqual(figure(restored).metadata, { custom: "-->", layout: info.layout });
  equal(restored.sliceString(figure(restored).image.from, figure(restored).image.to), embed);
  ok(restored.toString().includes(embed + " ^image-block"));
  ok(restored.toString().endsWith(figureClose + "\n\nUnrelated."));
});

void test("converts a timestamp image in one transaction and keeps the title and siblings", () => {
  const title = "- [03:09](https://example.com?t=189) Extra IPv4";
  const source = document(`- Previous\n${title} ${image}\n- Next`);
  const reference = imageReferences(source).references[0];
  const result = wrapImage(source, reference, { crop: [.25, .25, .5, .25], forCaption: true });
  ok(result);
  let state = EditorState.create({ doc: source, extensions: history() });
  state = state.update({ changes: result.changes, annotations: isolateHistory.of("full") }).state;
  equal(state.doc.line(2).text, title);
  equal(state.doc.line(state.doc.lines).text, "- Next");
  equal(figure(state.doc).caption, "");
  equal(captionCursor(state.doc, figure(state.doc)), result.cursor);
  const after = state.doc;
  const target = { get state() { return state; }, dispatch: (tr: ReturnType<EditorState["update"]>) => { state = tr.state; } };
  ok(undo(target));
  equal(state.doc.toString(), source.toString());
  ok(redo(target));
  equal(state.doc.toString(), after.toString());
});

void test("normalizes a lazy image in its owning bullet without changing its prefix or next item", () => {
  const source = document(`- Title\n${image}\n- Next`);
  const result = wrapImage(source, imageReferences(source).references[0], { forCaption: true });
  ok(result);
  const after = patch(source, result.changes);
  equal(after.line(1).text, "- Title");
  equal(after.line(after.lines).text, "- Next");
  equal(figure(after).indent, 2);
  equal(captionCursor(after, figure(after)), result.cursor);
  for (const invalid of [`- Title ${image} ^other`, `- ${image} ^item`, `${image} trailing`, `${image} ${image}`]) {
    const doc = document(invalid);
    equal(canWrapImage(doc, imageReferences(doc).references[0]), false, invalid);
  }
});

void test("adds a real editable caption line to a tight figure without touching its attachment or closing indentation", () => {
  const source = document("- Parent\n\n" + indent([formatOpening({ crop }), image + " ^example", figureClose].join("\n")) + "\n- Tail");
  const item = figure(source);
  equal(captionCursor(source, item), undefined);
  const edit = createCaptionRow(source, item);
  ok(edit?.cursor);
  const next = patch(source, edit.changes);
  equal(captionCursor(next, figure(next)), edit.cursor);
  equal(next.lineAt(edit.cursor).text, "  ");
  equal(next.lineAt(figure(next).closing.from).text, "  " + figureClose);
  deepEqual(figure(next).crop, item.crop);
  const populated = next.replace(edit.cursor, edit.cursor, document("**注释** [[Reference]]"));
  equal(figure(populated).caption, "**注释** [[Reference]]");
  equal(captionCursor(populated, figure(populated)), edit.cursor);
  equal(populated.toString().endsWith("\n- Tail"), true);
});

void test("keeps existing empty rows and pads only the editable line in a tab-indented figure", () => {
  const input = document("- Parent\n\n\t" + starter + "\n\t" + image + "\n\t\n \n\t\n\t" + figureClose);
  const item = figure(input);
  const result = createCaptionRow(input, item);
  ok(result?.cursor);
  equal(result.changes.from, result.changes.to);
  equal(result.changes.insert, " ");
  const updated = patch(input, result.changes);
  equal(updated.toString(), input.toString().replace("\n \n", "\n  \n"));
  equal(captionCursor(updated, figure(updated)), result.cursor);
});
