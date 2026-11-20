import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, Text } from "@codemirror/state";
import { captionIndex, captionInsertion } from "../src/caption-source";
import { cropChange, cropInset, moveCrop, type Crop } from "../src/crop-state";
import { imageReferences } from "../src/image-source";

const doc = (source: string) => Text.of(source.split("\n"));
const crop = [0.25, 0.25, 0.5, 0.25] as const;
const marker = ' <!-- live-image-editor-peng:v1 {"crop":[0.25,0.25,0.5,0.25]} -->';

void test("indexes WikiLinks and Markdown images in text, Callouts, and GFM table cells", () => {
  const source = doc([
    "![[beam.png|240]] ![[beam.png|240]]" + marker,
    "",
    "> [!note]",
    "> ![beam](<a (b).png>)",
    "",
    "| Picture |",
    "| --- |",
    "| ![[beam.png\\|120]] |"
  ].join("\n"));
  const index = imageReferences(source);
  equal(imageReferences(source), index);
  deepEqual(index.references.map(image => image.target), ["beam.png", "beam.png", "a (b).png", "beam.png"]);
  const [first, second] = index.lines.get(1) ?? [];
  equal(first?.marker, undefined);
  deepEqual(second?.marker?.crop, crop);
  equal(source.sliceString(second?.from, second?.to), "![[beam.png|240]]");
});

void test("excludes literal examples, self-contained foreign layouts, and unloaded wiki types", () => {
  const source = doc([
    "---", "example: '![[ignored.png]]'", "---", "",
    "%% ![[hidden.png]] %%", "`![[inline.png]]`",
    "", "```md", "![[fenced.png]]", "```", "",
    "<!-- vml -->", "![[foreign.png]]", "<!-- /vml -->", "",
    "\\![[escaped.png]] ![[note.pdf]] ![[shown.webp]]"
  ].join("\n"));
  deepEqual(imageReferences(source).references.map(image => image.target), ["shown.webp"]);
});

void test("writes and removes only the crop metadata next to the selected occurrence", () => {
  const original = "- ![[beam.png|240x120]] ![Control](beam.png)  ";
  let state = EditorState.create({ doc: original, extensions: [history()] });
  const dispatch = (transaction: ReturnType<typeof state.update>) => { state = transaction.state; };
  const image = imageReferences(state.doc).references[0];
  ok(image);
  const change = cropChange(state.doc, image.to, crop);
  ok(change);
  dispatch(state.update({ changes: change, annotations: isolateHistory.of("full") }));
  const edited = original.replace("]] ", "]]" + marker + " ");
  equal(state.doc.toString(), edited);
  ok(undo({ state, dispatch }));
  equal(state.doc.toString(), original);
  ok(redo({ state, dispatch }));
  equal(state.doc.toString(), edited);
  const restore = cropChange(state.doc, image.to);
  ok(restore);
  equal(state.update({ changes: restore }).newDoc.toString(), original);
});

void test("updates one marker and treats a full image as restore", () => {
  const source = doc("![beam](beam.png)" + marker);
  const image = imageReferences(source).references[0];
  ok(image);
  const next = cropChange(source, image.to, [0.1, 0.2, 0.3, 0.4]);
  ok(next);
  const result = source.replace(next.from, next.to, Text.of([next.insert]));
  deepEqual(imageReferences(result).references[0]?.marker?.crop, [0.1, 0.2, 0.3, 0.4]);
  deepEqual(cropChange(result, image.to, [0, 0, 1, 1]), { from: next.from, to: result.length, insert: "" });
});

void test("does not overwrite an unsupported version, malformed or duplicate marker", () => {
  for (const value of [marker.replace(":v1", ":v2"), marker.replace("0.5", "2"), marker.replace("0.5", "null"),
    marker.replace("0.5", ""), marker + marker, marker.slice(0, -3)]) {
    const source = doc("![[beam.png]]" + value);
    const image = imageReferences(source).references[0];
    ok(image?.marker);
    equal(image.marker.crop, undefined);
    equal(cropChange(source, image.to, crop), undefined);
    equal(cropChange(source, image.to), undefined);
  }
});

void test("keeps native captions associated and adds a caption after the full cropped image line", () => {
  const source = doc("- Parent\n  - ![[beam.png|251]]" + marker +
    "\n    <!-- image-caption:start -->\n    Nested **caption**.\n\n    <!-- image-caption:end -->");
  const index = captionIndex(source);
  const image = index.images.get(2);
  ok(image);
  equal(index.captionedImages.get(image.from)?.body, "Nested **caption**.");
  equal(source.sliceString(image.from, image.to), "![[beam.png|251]]");
  equal(captionInsertion(source, image).from, source.line(2).to);
});

void test("maps crop coordinates to CSS and bounds selection handles within the image", () => {
  equal(cropInset(crop), "inset(25% 25% 50% 25%)");
  deepEqual(moveCrop(crop, "move", 1, -1, 0.1, 0.1), [0.5, 0, 0.5, 0.25]);
  deepEqual(moveCrop(crop, "nw", -1, -1, 0.1, 0.1), [0, 0, 0.75, 0.5]);
  const minimum: Crop = moveCrop(crop, "se", -1, -1, 0.125, 0.125);
  deepEqual(minimum, [0.25, 0.25, 0.125, 0.125]);
});
