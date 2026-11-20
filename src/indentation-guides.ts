interface Guide {
  marker: HTMLElement;
  left: number;
  width: number;
  color: string;
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
