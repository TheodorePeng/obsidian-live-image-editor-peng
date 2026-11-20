import type { Text } from "@codemirror/state";

export type Crop = readonly [x: number, y: number, width: number, height: number];

export interface CropMarker {
  from: number;
  to: number;
  crop?: Crop;
}

const markerPrefix = "<!-- live-image-editor-peng:v";

function validCrop(value: unknown): value is Crop {
  if (!Array.isArray(value) || value.length !== 4 ||
      !value.every(part => typeof part === "number" && Number.isFinite(part))) return false;
  const [x, y, width, height] = value as unknown as Crop;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 + 1e-9 && y + height <= 1 + 1e-9;
}

export function cropMarker(doc: Text, imageEnd: number): CropMarker | undefined {
  const suffix = doc.sliceString(imageEnd, doc.lineAt(imageEnd).to);
  const separator = /^[ \t]+/.exec(suffix)?.[0];
  if (!separator || !suffix.startsWith(markerPrefix, separator.length)) return;
  const end = suffix.indexOf("-->", separator.length);
  const marker: CropMarker = { from: imageEnd + separator.length - 1, to: end < 0 ? imageEnd + suffix.length : imageEnd + end + 3 };
  if (end < 0 || separator.length !== 1 || suffix.slice(end + 3).trimStart().startsWith(markerPrefix)) return marker;
  const comment = suffix.slice(separator.length, end);
  const payload = /^<!-- live-image-editor-peng:v1 (.+) $/.exec(comment)?.[1];
  if (!payload) return marker;
  try {
    const value = (JSON.parse(payload) as { crop?: unknown } | null)?.crop;
    if (validCrop(value)) marker.crop = value;
  } catch {
    // Leave malformed user source untouched.
  }
  return marker;
}

export function cropChange(doc: Text, imageEnd: number, crop?: Crop) {
  const marker = cropMarker(doc, imageEnd);
  if (marker && !marker.crop) return;
  if (!crop || crop.every((value, index) => value === (index < 2 ? 0 : 1))) {
    return marker && { from: marker.from, to: marker.to, insert: "" };
  }
  if (!validCrop(crop)) return;
  const rounded = crop.map(value => Number(value.toFixed(6)));
  const coordinates = validCrop(rounded) ? rounded : crop;
  if (marker?.crop?.every((value, index) => value === coordinates[index])) return;
  const insert = ` ${markerPrefix}1 ${JSON.stringify({ crop: coordinates })} -->`;
  const from = marker?.from ?? imageEnd;
  const to = marker?.to ?? imageEnd;
  if (doc.sliceString(from, to) !== insert) return { from, to, insert };
}

export function cropInset([x, y, width, height]: Crop): string {
  return `inset(${y * 100}% ${Math.max(0, 1 - x - width) * 100}% ${Math.max(0, 1 - y - height) * 100}% ${x * 100}%)`;
}

export const cropHandles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type CropHandle = (typeof cropHandles)[number] | "move";

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function moveCrop(crop: Crop, handle: CropHandle, dx: number, dy: number, minWidth: number, minHeight: number): Crop {
  const [x, y, width, height] = crop;
  if (handle === "move") return [clamp(x + dx, 0, 1 - width), clamp(y + dy, 0, 1 - height), width, height];
  const right = x + width;
  const bottom = y + height;
  const left = handle.includes("w") ? clamp(x + dx, 0, right - minWidth) : x;
  const top = handle.includes("n") ? clamp(y + dy, 0, bottom - minHeight) : y;
  return [
    left,
    top,
    (handle.includes("e") ? clamp(right + dx, x + minWidth, 1) : right) - left,
    (handle.includes("s") ? clamp(bottom + dy, y + minHeight, 1) : bottom) - top
  ];
}
