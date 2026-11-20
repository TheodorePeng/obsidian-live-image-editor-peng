import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { imageActionCompanion, imageActionPosition } from "../src/image-action-placement";

const clip = { left: 0, top: 0, right: 800, bottom: 600 };
const image = { left: 60, top: 100, right: 260, bottom: 212 };

void test("places the full hit area at the image's bottom left", () => {
  deepEqual(imageActionPosition(image, clip, []), { left: 65, top: 183, size: 24 });
});

void test("keeps the button in the bottom-left quadrant without touching controls", () => {
  const controls = [
    { left: 60, top: 183, right: 77, bottom: 212 },
    { left: 60, top: 160, right: 88, bottom: 181 }
  ];
  const button = imageActionPosition(image, clip, controls);
  ok(button);
  ok(button.left + button.size / 2 <= (image.left + image.right) / 2);
  ok(button.top + button.size / 2 >= (image.top + image.bottom) / 2);
  ok(controls.every(control => button.left + button.size <= control.left ||
    button.left >= control.right || button.top + button.size <= control.top || button.top >= control.bottom));
});

void test("fits the hit area to the visible part and hides it below the minimum", () => {
  const small = { left: 100, top: 580, right: 140, bottom: 619 };
  deepEqual(imageActionPosition(small, clip, []), { left: 102, top: 582, size: 16 });
  equal(imageActionPosition({ ...small, top: 590 }, clip, []), undefined);
});

void test("does not shift outside the image when the lower-left area is occupied", () => {
  const blocker = { left: 60, top: 150, right: 178, bottom: 212 };
  equal(imageActionPosition(image, clip, [blocker]), undefined);
});

void test("adds the caption to the right while keeping the crop position and size", () => {
  const crop = imageActionPosition(image, clip, []);
  ok(crop);
  deepEqual(imageActionCompanion(image, clip, [], crop), { left: 93, top: 183, size: 24 });
  deepEqual(crop, { left: 65, top: 183, size: 24 });
});

void test("leaves the crop alone when the right slot is clipped or occupied", () => {
  const crop = imageActionPosition(image, clip, []);
  ok(crop);
  equal(imageActionCompanion(image, { ...clip, right: 116 }, [], crop), undefined);
  const control = { left: 105, top: 185, right: 128, bottom: 208 };
  equal(imageActionCompanion(image, clip, [control], crop), undefined);
  deepEqual(imageActionPosition(image, clip, [control]), crop);
});
