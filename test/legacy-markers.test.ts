import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { legacyNoticeText, scanLegacyMarkers } from "../src/legacy-markers";

const crop = '![[beam.png|251]] <!-- live-image-editor-peng:v1 {"crop":[0.15,0.2,0.6,0.5]} -->';
const caption = ["![[beam.png|300]]", "<!-- image-caption:start -->", "**Figure 1**", "<!-- image-caption:end -->"];
const figure = [
  '<!-- live-image-figure:v1 {"crop":{"x":0.1,"y":0.2,"width":0.7,"height":0.4}} -->',
  "![[beam.png|191]]",
  "",
  "Figure 1",
  "<!-- /live-image-figure -->"
];

void test("finds the pre-0.3 crop marker that trails an image on the same line", () => {
  equal(scanLegacyMarkers(crop).crop, true);
  equal(scanLegacyMarkers(crop).caption, false);
});

void test("finds either half of a pre-0.3 caption marker pair", () => {
  equal(scanLegacyMarkers(caption.join("\n")).caption, true);
  equal(scanLegacyMarkers("<!-- image-caption:start -->").caption, true);
  equal(scanLegacyMarkers("<!-- image-caption:end -->").caption, true);
  equal(scanLegacyMarkers(caption.join("\n")).crop, false);
});

void test("reports both kinds when a note mixes old crops and old captions", () => {
  equal(scanLegacyMarkers([crop, "", ...caption].join("\n")).crop, true);
  equal(scanLegacyMarkers([crop, "", ...caption].join("\n")).caption, true);
});

void test("ignores notes that carry no pre-0.3 marker", () => {
  const plain = ["# Note", "", "![[beam.png|240]]", "", "Plain paragraph."].join("\n");
  equal(scanLegacyMarkers(plain).crop, false);
  equal(scanLegacyMarkers(plain).caption, false);
  equal(scanLegacyMarkers("").crop, false);
});

void test("does not mistake a live-image-figure block for a pre-0.3 marker", () => {
  equal(scanLegacyMarkers(figure.join("\n")).crop, false);
  equal(scanLegacyMarkers(figure.join("\n")).caption, false);
});

void test("skips fenced code blocks so a syntax example does not trigger a notice", () => {
  const fenced = ["```markdown", crop, "<!-- image-caption:start -->", "```", ""].join("\n");
  equal(scanLegacyMarkers(fenced).crop, false);
  equal(scanLegacyMarkers(fenced).caption, false);
  const tilde = ["~~~", crop, "~~~", ""].join("\n");
  equal(scanLegacyMarkers(tilde).crop, false);
});

void test("skips inline code so a quoted marker does not trigger a notice", () => {
  equal(scanLegacyMarkers(`Write \`${crop}\` to restore.`).crop, false);
  equal(scanLegacyMarkers("Use `<!-- image-caption:start -->` as the opening marker.").caption, false);
});

void test("still reads a real marker that follows an inline code span on the same line", () => {
  equal(scanLegacyMarkers(`${crop} and \`code\``).crop, true);
});

void test("explains what to do for each kind of pre-0.3 marker", () => {
  ok(legacyNoticeText({ crop: true, caption: false }).includes("重新裁剪"));
  ok(legacyNoticeText({ crop: false, caption: true }).includes("删除旧的 image-caption 标记块"));
  const both = legacyNoticeText({ crop: true, caption: true });
  ok(both.includes("重新裁剪"));
  ok(both.includes("删除旧的 image-caption 标记块"));
  equal(legacyNoticeText({ crop: false, caption: false }), "");
});
