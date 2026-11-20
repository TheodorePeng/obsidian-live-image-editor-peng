import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { Text } from "@codemirror/state";
import { captionIndex, captionInsertion } from "../src/caption-source";

const fence = "```";
const document = (...lines: string[]) => Text.of(lines);

void test("inserts and re-associates at depths 0 through 4 without rewriting surrounding lines", () => {
  for (let depth = 0; depth <= 4; depth++) {
    const prefix = Array.from({ length: Math.max(0, depth - 1) }, (_, index) => "  ".repeat(index) + "- Parent");
    const marker = depth ? "  ".repeat(depth - 1) + "- " : "";
    const source = document(...prefix, marker + "![[beam.png|200]]  ", "", "Untouched");
    const image = captionIndex(source).images.get(depth || 1);
    ok(image);
    const { from, insert, cursor } = captionInsertion(source, image);
    const updated = source.replace(from, from, Text.of(insert.split("\n")));
    equal(updated.sliceString(0, from), source.sliceString(0, from));
    equal(updated.sliceString(from + insert.length), source.sliceString(from));
    const indent = "  ".repeat(depth);
    equal(updated.line(image.line + 1).text, indent + fence + "image-caption");
    equal(updated.lineAt(cursor).number, image.line + 2);
    equal(updated.lineAt(cursor).text, indent);
    const index = captionIndex(updated);
    ok(index.captionedImages.has(image.from));
    equal([...index.captions.values()][0]?.input, cursor);
  }
});

void test("uses marker width for ordered lists and matches nested continuation images", () => {
  const source = document("12. Example", "", "    ![beam](<folder/a b.png>)", "    Text continues");
  const image = captionIndex(source).images.get(3);
  ok(image);
  equal(image.indent, 4);
  const { from, insert } = captionInsertion(source, image);
  const result = source.replace(from, from, Text.of(insert.split("\n")));
  equal(result.line(4).text, "    " + fence + "image-caption");
  equal(result.line(8).text, "    Text continues");
  ok(captionIndex(result).captionedImages.has(image.from));
});

void test("binds only the closest standalone image in the same container", () => {
  const doc = document(
    "![[same.png]]", "![[same.png]]", "", fence + "image-caption", "Second", fence,
    "", "Separate ![[inline.png]]", "", fence + "image-caption", "Orphan", fence,
    "", "- ![[sibling.png]]", "- Another item", "", "  " + fence + "image-caption", "  Orphan", "  " + fence
  );
  const index = captionIndex(doc);
  deepEqual([...index.images.keys()], [1, 2, 14]);
  equal(index.captions.get(4)?.image?.line, 2);
  equal(index.captions.get(10)?.image, undefined);
  equal(index.captions.get(17)?.image, undefined);
  equal(index.captionedImages.size, 1);
});

void test("preserves rich Markdown body indentation and derives text entry offset", () => {
  const doc = document("- One", "  - Two", "    - Three", "", "      ![[beam.png]]", "",
    "      " + fence + "image-caption", "      **Caption**", "      ", "      - Item",
    "        1. Nested", "", "      $$", "      M = FL/4", "      $$", "      " + fence);
  const caption = captionIndex(doc).captions.get(7);
  equal(caption?.body, "**Caption**\n\n- Item\n  1. Nested\n\n$$\nM = FL/4\n$$");
  equal(caption?.input, doc.line(8).from + 6);
  equal(caption?.image?.line, 5);
});

void test("recognizes empty and unfinished fences without treating them as a new insertion opportunity", () => {
  const empty = document("![alt](https://example.com/picture)", "", fence + "image-caption", fence);
  const open = document("![[a.png]]", "", fence + "image-caption", "Draft");
  equal(captionIndex(empty).captions.get(3)?.body, "");
  equal(captionIndex(empty).captions.get(3)?.closed, true);
  equal(captionIndex(open).captions.get(3)?.closed, false);
  equal(captionIndex(empty).captionedImages.size, 1);
  equal(captionIndex(open).captionedImages.size, 1);
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
    "![[outside.png]]", "", fence + "image-caption", "Visible", fence);
  const index = captionIndex(doc);
  deepEqual([...index.images.keys()], [5]);
  equal(index.captions.get(7)?.image?.line, 5);
});

void test("keeps the image target for each appearance and the source span of its caption", () => {
  const doc = document("![First](<media/folder A.png>)", "![[folder/beam.png|120]]", "",
    fence + "image-caption", "Second image", fence);
  const index = captionIndex(doc);
  equal(index.images.get(1)?.target, "media/folder A.png");
  equal(index.captions.get(4)?.image?.target, "folder/beam.png");
  equal(index.captions.get(4)?.endLine, 6);
});

const start = "<!-- image-caption:start -->";
const end = "<!-- image-caption:end -->";

void test("creates an adjacent native Markdown caption with the correct caret and separator at depths zero through five", () => {
  for (let depth = 0; depth <= 5; depth++) {
    const ancestors = Array.from({ length: Math.max(0, depth - 1) }, (_, index) => "  ".repeat(index) + "- Parent");
    const marker = depth ? "  ".repeat(depth - 1) + "* " : "";
    const indent = "  ".repeat(depth);
    const source = document(...ancestors, marker + "![[beam.png]]", "", "Untouched");
    const image = captionIndex(source).images.get(ancestors.length + 1);
    ok(image);
    const { from, insert, cursor } = captionInsertion(source, image, "comment");
    const after = source.replace(from, from, Text.of(insert.split("\n")));
    const caption = captionIndex(after).captionedImages.get(image.from);
    equal(caption?.format, "comment");
    equal(caption?.closed, true);
    equal(caption?.input, cursor);
    equal(caption?.body, "");
    equal(after.line(image.line + 1).text, indent + start);
    equal(after.line(image.line + 2).text, indent);
    equal(after.line(image.line + 3).text, "");
    equal(after.line(image.line + 4).text, indent + end);
    equal(after.sliceString(from + insert.length), source.sliceString(from));
  }
});

void test("pairs repeated references independently in a mixed-format note and preserves native block descriptors", () => {
  const source = document(
    "- Parent", "  - ![[beam.png]]", "    " + start, "    [[First]]", "", "    - Nested", "", "    $$",
    "    x^2", "    $$", "", "    " + end, "  - ![[beam.png]]",
    "    " + fence + "image-caption", "    Second", "    " + fence
  );
  const { captionedImages, images } = captionIndex(source);
  const first = images.get(2);
  const second = images.get(13);
  ok(first && second);
  const caption = captionedImages.get(first.from);
  equal(caption?.format, "comment");
  equal(caption?.body, "[[First]]\n\n- Nested\n\n$$\nx^2\n$$");
  deepEqual(caption?.blocks, ["Paragraph", "BulletList", "Math"]);
  equal(captionedImages.get(second.from)?.format, "fence");
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
