import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { Text } from "@codemirror/state";
import { cropInset, cropWidthForHeight, moveCrop, type Crop } from "../src/crop-state";
import { imageReferences } from "../src/image-source";

const doc = (source: string) => Text.of(source.split("\n"));
const crop = [0.25, 0.25, 0.5, 0.25] as const;

void test("only supplies a width limit for a positive native height, using the cropped aspect ratio", () => {
  equal(cropWidthForHeight(crop, 640, 320, "40"), 160);
  equal(cropWidthForHeight([0, 0, 0.5, 1], 640, 320, "40"), 40);
  for (const attribute of [null, "", "0", "-1", "auto", "Infinity"]) {
    equal(cropWidthForHeight(crop, 640, 320, attribute), undefined);
  }
});

void test("indexes WikiLinks and Markdown images in text, Callouts, and GFM table cells", () => {
  const source = doc([
    "![[beam.png|240]] ![[beam.png|240]]",
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
  equal(first?.target, second?.target);
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

void test("maps crop coordinates to CSS and bounds selection handles within the image", () => {
  equal(cropInset(crop), "inset(25% 25% 50% 25%)");
  deepEqual(moveCrop(crop, "move", 1, -1, 0.1, 0.1), [0.5, 0, 0.5, 0.25]);
  deepEqual(moveCrop(crop, "nw", -1, -1, 0.1, 0.1), [0, 0, 0.75, 0.5]);
  const minimum: Crop = moveCrop(crop, "se", -1, -1, 0.125, 0.125);
  deepEqual(minimum, [0.25, 0.25, 0.125, 0.125]);
});
