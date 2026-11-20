import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { Text } from "@codemirror/state";
import { captionIndex, captionInsertion } from "../src/caption-source";

const fence = "```";
const start = "<!-- image-caption:start -->";
const end = "<!-- image-caption:end -->";
const document = (...lines: string[]) => Text.of(lines);

void test("uses marker width for ordered lists and matches nested continuation images", () => {
  const source = document("12. Example", "", "    ![beam](<folder/a b.png>)", "    Text continues");
  const image = captionIndex(source).images.get(3);
  ok(image);
  equal(image.indent, 4);
  const { from, insert } = captionInsertion(source, image);
  const result = source.replace(from, from, Text.of(insert.split("\n")));
  equal(result.line(4).text, "    " + start);
  equal(result.line(9).text, "    Text continues");
  ok(captionIndex(result).captionedImages.has(image.from));
});

void test("binds only the closest standalone image in the same container", () => {
  const doc = document(
    "![[same.png]]", "![[same.png]]", "", start, "Second", "", end,
    "", "Separate ![[inline.png]]", "", start, "Orphan", "", end,
    "", "- ![[sibling.png]]", "- Another item", "", "  " + start, "  Orphan", "  " + end
  );
  const index = captionIndex(doc);
  deepEqual([...index.images.keys()], [1, 2, 16]);
  equal(index.captions.get(4)?.image?.line, 2);
  equal(index.captions.get(11)?.image, undefined);
  equal(index.captions.get(19)?.image, undefined);
  equal(index.captionedImages.size, 1);
});

void test("excludes frontmatter, comments, inline code, ordinary fences, and multiple images on one line", () => {
  const doc = document(
    "---", "![[yaml.png]]", "---", "", "%%", "![[comment.png]]", "%%", "",
    "`![[inline.png]]`", "", fence + "markdown", "![[code.png]]", fence, "",
    "![[multiple-a.png]] ![[multiple-b.png]]", "", "![[not-an-image.pdf]]", "",
    "Text with `%%`", "", "![[A photo (1).png|200x100]]"
  );
  const index = captionIndex(doc);
  deepEqual([...index.images.keys()], [21]);
});

void test("avoids inserting inside an Adjustable Media layout", () => {
  const doc = document('<!-- vml {"v":2} -->', "![[inside.png]]", "<!-- /vml -->", "",
    "![[outside.png]]", "", start, "Visible", "", end);
  const index = captionIndex(doc);
  deepEqual([...index.images.keys()], [5]);
  equal(index.captions.get(7)?.image?.line, 5);
});

void test("keeps the image target for each appearance and the source span of its caption", () => {
  const doc = document("![First](<media/folder A.png>)", "![[folder/beam.png|120]]", "",
    start, "Second image", "", end);
  const index = captionIndex(doc);
  equal(index.images.get(1)?.target, "media/folder A.png");
  equal(index.captions.get(4)?.image?.target, "folder/beam.png");
  equal(index.captions.get(4)?.endLine, 7);
});

void test("creates an adjacent native Markdown caption with the correct caret and separator at depths zero through five", () => {
  for (let depth = 0; depth <= 5; depth++) {
    const ancestors = Array.from({ length: Math.max(0, depth - 1) }, (_, index) => "  ".repeat(index) + "- Parent");
    const marker = depth ? "  ".repeat(depth - 1) + "* " : "";
    const indent = "  ".repeat(depth);
    const source = document(...ancestors, marker + "![[beam.png]]", "", "Untouched");
    const image = captionIndex(source).images.get(ancestors.length + 1);
    ok(image);
    const { from, insert, cursor } = captionInsertion(source, image);
    const after = source.replace(from, from, Text.of(insert.split("\n")));
    const caption = captionIndex(after).captionedImages.get(image.from);
    equal(caption?.closed, true);
    equal(after.lineAt(cursor).number, image.line + 2);
    equal(after.lineAt(cursor).to, cursor);
    equal(caption?.body, "");
    equal(after.line(image.line + 1).text, indent + start);
    equal(after.line(image.line + 2).text, indent);
    equal(after.line(image.line + 3).text, "");
    equal(after.line(image.line + 4).text, indent + end);
    equal(after.sliceString(from + insert.length), source.sliceString(from));
  }
});

void test("pairs repeated references independently in a note and preserves native block descriptors", () => {
  const source = document(
    "- Parent", "  - ![[beam.png]]", "    " + start, "    [[First]]", "", "    - Nested", "", "    $$",
    "    x^2", "    $$", "", "    " + end, "  - ![[beam.png]]",
    "    " + start, "    Second", "", "    " + end
  );
  const { captionedImages, images } = captionIndex(source);
  const first = images.get(2);
  const second = images.get(13);
  ok(first && second);
  const caption = captionedImages.get(first.from);
  equal(caption?.body, "[[First]]\n\n- Nested\n\n$$\nx^2\n$$");
  deepEqual(caption?.blocks, ["Paragraph", "BulletList", "Math"]);
  equal(captionedImages.get(second.from)?.body, "Second");
});

void test("leaves overlapping and cross-item markers open without assigning another image", () => {
  const overlap = document("![[beam.png]]", start, "Draft", start, "Caption", "", end, end);
  const cross = document("- ![[beam.png]]", "  " + start, "  Draft", "- Other", "  " + end);
  for (const source of [overlap, cross]) {
    const index = captionIndex(source);
    equal([...index.captions.values()].some(caption => caption.closed), false);
    equal(index.captionedImages.size, 1);
  }
  const fake = document(fence + "md", "![[beam.png]]", start, "Fake", end, fence);
  equal(captionIndex(fake).captions.size, 0);
});

void test("leaves a terminal list native until a blank separates it from the end marker", () => {
  for (const [gap, closed] of [[[], false], [[""], true]] as const) {
    const source = document("- ![[beam.png]]", "  " + start, "  - Final item", ...gap, "  " + end);
    equal(captionIndex(source).captions.get(2)?.closed, closed);
  }
});

void test("leaves comments inside a parameterless Adjustable Media layout alone", () => {
  const source = document("<!-- vml -->", "![[beam.png]]", start, "Other plugin's content.", "", end, "<!-- /vml -->");
  equal(captionIndex(source).captions.size, 0);
});
