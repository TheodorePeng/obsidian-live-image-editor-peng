const nativeRow = "image-caption-peng--indent-origin";
const nativeMark = "image-caption-peng--indent-mark";
const fallbackFrame = "image-caption-peng--indent-frame";
const fallbackClass = "image-caption-peng__indent-segments";
const lengthProperty = "--image-caption-indent-height";
const shiftProperty = "--image-caption-indent-shift";

interface Guide {
  marker: HTMLElement;
  left: number;
  width: number;
  color: string;
}

export interface IndentationPair {
  imageRow: HTMLElement;
  frame: HTMLElement;
  opening?: HTMLElement;
}

export function readIndentationGuides(row: HTMLElement): Guide[] {
  const win = row.doc.defaultView;
  if (!win) return [];
  return Array.from(row.querySelectorAll<HTMLElement>(".cm-indent")).flatMap(marker => {
    const host = marker.offsetParent;
    if (host !== row) return [];
    const line = win.getComputedStyle(marker, "::before");
    const before = Number.parseFloat(line.left);
    const after = Number.parseFloat(line.borderRightWidth);
    const width = after || Number.parseFloat(line.borderLeftWidth);
    const color = after ? line.borderRightColor : line.borderLeftColor;
    if (line.display === "none" || line.opacity === "0" || line.visibility !== "visible" || line.content === "none" ||
        !Number.isFinite(before) || !width || !color || color === "transparent") return [];
    const borderOffset = after ? Number.parseFloat(line.width) - (line.boxSizing === "border-box" ? after : 0) : 0;
    if (!Number.isFinite(borderOffset)) return [];
    return [{ marker, left: row.getBoundingClientRect().left + row.clientLeft + before + (Number.parseFloat(line.marginLeft) || 0) + borderOffset, width, color }];
  });
}

export class CaptionIndentation {
  private rows = new Map<HTMLElement, HTMLElement[]>();
  private overlays = new Map<HTMLElement, HTMLElement>();

  update(pairs: readonly IndentationPair[]): void {
    const nextRows = new Map<HTMLElement, HTMLElement[]>();
    const nextOverlays = new Map<HTMLElement, HTMLElement>();
    for (const { imageRow, frame, opening } of pairs) {
      const references = readIndentationGuides(imageRow);
      if (!references.length) continue;
      const imageBox = imageRow.getBoundingClientRect();
      const captionBox = frame.getBoundingClientRect();
      if (captionBox.height <= 0 || Math.abs(captionBox.top - imageBox.bottom) > 6) continue;

      if (opening && opening.hasClass("image-caption-peng--compact-line")) {
        const native = readIndentationGuides(opening);
        const box = opening.getBoundingClientRect();
        if (box.height === 0 && Math.abs(box.top - imageBox.bottom) <= 1 &&
            native.length === references.length && native.every((line, index) => {
              const reference = references[index];
              return Math.abs(line.left - reference.left) <= 32 && line.width === reference.width && line.color === reference.color;
            })) {
          const value = `${captionBox.bottom - box.top}px`;
          if (opening.style.getPropertyValue(lengthProperty) !== value) opening.setCssProps({ [lengthProperty]: value });
          if (!opening.hasClass(nativeRow)) opening.addClass(nativeRow);
          const marks = native.map(line => line.marker);
          for (const marker of this.rows.get(opening) ?? []) {
            if (!marks.includes(marker)) this.clearMarker(marker);
          }
          for (const [index, { marker, left }] of native.entries()) {
            // The compact line has zero font size, so Obsidian's em-based inset resolves to zero.
            const shift = `${references[index].left - left}px`;
            if (marker.style.getPropertyValue(shiftProperty) !== shift) marker.setCssProps({ [shiftProperty]: shift });
            if (!marker.hasClass(nativeMark)) marker.addClass(nativeMark);
          }
          nextRows.set(opening, marks);
          continue;
        }
      }

      if (!frame.hasClass(fallbackFrame)) frame.addClass(fallbackFrame);
      const overlay = this.overlays.get(frame) ?? frame.createDiv({ cls: fallbackClass, attr: { "aria-hidden": "true" } });
      while (overlay.childElementCount > references.length) overlay.lastElementChild?.remove();
      for (const [index, reference] of references.entries()) {
        const line = overlay.children[index] as HTMLElement | undefined ?? overlay.createDiv();
        const style = {
          "--image-caption-indent-x": `${reference.left - captionBox.left - frame.clientLeft}px`,
          "--image-caption-indent-y": `${imageBox.bottom - captionBox.top - frame.clientTop}px`,
          "--image-caption-indent-width": `${reference.width}px`,
          "--image-caption-indent-color": reference.color
        };
        for (const [property, value] of Object.entries(style)) {
          if (line.style.getPropertyValue(property) !== value) line.setCssProps({ [property]: value });
        }
      }
      nextOverlays.set(frame, overlay);
    }

    for (const [row, marks] of this.rows) {
      if (nextRows.has(row)) continue;
      row.removeClass(nativeRow);
      row.style.removeProperty(lengthProperty);
      for (const marker of marks) this.clearMarker(marker);
    }
    for (const [frame, overlay] of this.overlays) {
      if (!nextOverlays.has(frame)) {
        overlay.remove();
        frame.removeClass(fallbackFrame);
      }
    }
    this.rows = nextRows;
    this.overlays = nextOverlays;
  }

  private clearMarker(marker: HTMLElement): void {
    marker.removeClass(nativeMark);
    marker.style.removeProperty(shiftProperty);
  }

  clear(): void {
    this.update([]);
  }
}
