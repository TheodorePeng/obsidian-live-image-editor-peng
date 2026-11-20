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
