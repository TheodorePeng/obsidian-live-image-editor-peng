export type Crop = readonly [x: number, y: number, width: number, height: number];

export function cropInset([x, y, width, height]: Crop): string {
  return `inset(${y * 100}% ${Math.max(0, 1 - x - width) * 100}% ${Math.max(0, 1 - y - height) * 100}% ${x * 100}%)`;
}

export function cropWidthForHeight([,, width, height]: Crop, naturalWidth: number, naturalHeight: number,
  heightAttribute: string | null): number | undefined {
  const limit = Number(heightAttribute);
  if (Number.isFinite(limit) && limit > 0) {
    return limit * (naturalWidth * width) / (naturalHeight * height);
  }
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
