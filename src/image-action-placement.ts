interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ActionPosition {
  left: number;
  top: number;
  size: number;
}

const preferredSize = 24;
const minimumSize = 16;
export const imageActionGap = 4;

export function imageActionPosition(picture: Bounds, clip: Bounds, controls: readonly Bounds[]): ActionPosition | undefined {
  const mirror = ({ left, right, top, bottom }: Bounds): Bounds =>
    ({ left: -right, right: -left, top: -bottom, bottom: -top });
  const position = cornerPosition(mirror(picture), mirror(clip), controls.map(mirror));
  if (position) {
    return { left: -position.left - position.size, top: -position.top - position.size, size: position.size };
  }
}

export function imageActionCompanion(picture: Bounds, clip: Bounds, controls: readonly Bounds[], primary: ActionPosition): ActionPosition | undefined {
  const { left, top, size } = primary;
  const companion = { left: left + size + imageActionGap, top, size };
  const right = companion.left + size;
  const bottom = top + size;
  if (right > Math.min(picture.right, clip.right)) return;
  if (controls.some(control => left + size < control.right && right > control.left &&
      top < control.bottom && bottom > control.top)) return;
  return companion;
}

function cornerPosition(picture: Bounds, clip: Bounds, controls: readonly Bounds[]): ActionPosition | undefined {
  const left = Math.max(picture.left, clip.left);
  const right = Math.min(picture.right, clip.right);
  const top = Math.max(picture.top, clip.top);
  const bottom = Math.min(picture.bottom, clip.bottom);
  const span = Math.min(right - left, bottom - top);
  if (span < minimumSize) return;

  const inset = Math.min(5, Math.floor((span - minimumSize) / 2));
  const largest = Math.min(preferredSize, Math.floor(span - 2 * inset));
  const sorted = [...controls].sort((first, second) => first.top - second.top);
  // Keep the hit area inside the visible image, with its center in the target quadrant.
  for (let size = largest; size >= minimumSize; size--) {
    const preferredLeft = right - inset - size;
    const columns = [preferredLeft, ...sorted.map(control => control.left - size - 2)];
    let closest: ActionPosition | undefined;
    let distance = Infinity;
    for (const x of columns) {
      if (x < left + inset || x > preferredLeft || x + size / 2 < (left + right) / 2) continue;
      const edge = x + size;
      let y = top + inset;
      for (const control of sorted) {
        if (x < control.right && edge > control.left && y < control.bottom && y + size > control.top) {
          y = control.bottom + 2;
        }
      }
      if (y + size > bottom - inset || y + size / 2 > (top + bottom) / 2 + 1) continue;
      const displacement = 2 * (preferredLeft - x) + y - top - inset;
      if (displacement < distance) {
        closest = { left: x, top: y, size };
        distance = displacement;
      }
    }
    if (closest) return closest;
  }
}
