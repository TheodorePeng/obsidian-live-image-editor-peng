import { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { type Crop } from "./crop-state";
import { columns, figureClose, figureIndex, formatOpening, hasOnlyBlockId, listIndent,
  metadataCrop, parentContainer, type Figure, type Span } from "./figure-source";
import type { ImageReference } from "./image-source";
import { imageReferences } from "./image-source";
import { parseDocument } from "./markdown-source";

export interface FigureChange extends Span {
  insert: string;
}

export interface FigureEdit {
  changes: FigureChange;
  cursor?: number;
}

function checked(doc: Text, changes: FigureChange, from: number, to: number, target: string): Figure | undefined {
  const next = doc.replace(changes.from, changes.to, Text.of(changes.insert.split("\n")));
  const figure = figureIndex(next).figures.find(candidate => candidate.from === from && candidate.to === to);
  if (figure?.image.target === target) return figure;
}

function editableGap(indent: string): string {
  return "\n\n" + indent + "\n\n";
}

export function captionCursor(doc: Text, figure: Figure): number | undefined {
  const first = doc.lineAt(figure.image.from).number + 1;
  const close = doc.lineAt(figure.closing.from).number;
  if (!figure.caption) {
    if (close - first < 3) return;
    const line = doc.line(first + 1);
    if (columns(line.text) >= figure.indent) return line.to;
    return;
  }
  for (let number = first; number < close; number++) {
    const line = doc.line(number);
    const prefix = /^[ \t]*/.exec(line.text)?.[0] ?? "";
    if (line.text.trim()) return line.from + prefix.length;
  }
}

export function createCaptionRow(doc: Text, figure: Figure): FigureEdit | undefined {
  if (figure.caption || captionCursor(doc, figure) !== undefined) return;
  const indent = " ".repeat(figure.indent);
  const image = doc.lineAt(figure.image.from);
  const close = doc.lineAt(figure.closing.from);
  const existingRows = close.number - image.number - 1;
  let at: number;
  let insert: string;
  let cursor: number;
  if (existingRows >= 3) {
    const line = doc.line(image.number + 2);
    at = line.to;
    insert = " ".repeat(figure.indent - columns(line.text));
    cursor = at + insert.length;
  } else {
    at = existingRows === 2 ? doc.line(image.number + 2).from : close.from;
    const leading = existingRows === 0 ? "\n" : "";
    insert = leading + indent + (existingRows === 2 ? "\n" : "\n\n");
    cursor = at + leading.length + indent.length;
  }
  const changes = { from: at, to: at, insert };
  if (checked(doc, changes, figure.from, figure.to + insert.length, figure.image.target)) return { changes, cursor };
}

function firstParagraph(doc: Text, ref: ImageReference): SyntaxNode | undefined {
  for (let node: SyntaxNode | null = parseDocument(doc).resolveInner(ref.from + 1, 1); node; node = node.parent) {
    if (node.name === "Paragraph") return node;
  }
}

export function canRevealImage(doc: Text, ref: ImageReference): boolean {
  if (figureIndex(doc).reserved.some(range => ref.from < range.to && ref.to > range.from)) return false;
  const paragraph = firstParagraph(doc, ref);
  return !!(paragraph && parentContainer(paragraph));
}

export function canWrapImage(doc: Text, ref: ImageReference): boolean {
  const line = doc.lineAt(ref.from);
  if (imageReferences(doc).lines.get(line.number)?.length !== 1 || !canRevealImage(doc, ref)) return false;
  const paragraph = firstParagraph(doc, ref);
  const owner = paragraph && parentContainer(paragraph);
  if (!paragraph || !owner) return false;
  const lineStart = Math.max(paragraph.from, line.from);
  const prefix = doc.sliceString(lineStart, ref.from);
  const tail = doc.sliceString(ref.to, line.to);
  const id = hasOnlyBlockId(tail);
  if (tail.trim() && !id) return false;
  const standalone = !prefix.trim();
  if (id && (!standalone || owner.name === "ListItem" && doc.lineAt(owner.from).number === line.number)) return false;
  return standalone || owner.name === "ListItem";
}

function cropRecord(crop: Crop | undefined): Record<string, number> | undefined {
  if (!crop || (crop[0] === 0 && crop[1] === 0 && crop[2] === 1 && crop[3] === 1)) return;
  const [x, y, width, height] = crop;
  const value = { x, y, width, height };
  if (metadataCrop(value)) return value;
}

export function wrapImage(doc: Text, ref: ImageReference, input: { crop?: Crop; forCaption?: boolean }): FigureEdit | undefined {
  if (!canWrapImage(doc, ref)) return;
  const crop = cropRecord(input.crop);
  if (!crop && !input.forCaption) return;
  const line = doc.lineAt(ref.from);
  const paragraph = firstParagraph(doc, ref);
  const owner = paragraph && parentContainer(paragraph);
  if (!owner || !paragraph) return;
  const indent = " ".repeat(listIndent(doc, owner));
  const prefix = doc.sliceString(Math.max(paragraph.from, line.from), ref.from);
  const bareBullet = owner.name === "ListItem" && doc.lineAt(owner.from).number === line.number && !prefix.trim();
  const header = formatOpening(crop ? { crop } : {});
  const image = doc.sliceString(ref.from, line.to);
  let before = bareBullet ? doc.sliceString(line.from, ref.from) : indent;
  if (prefix.trim()) before = doc.sliceString(line.from, ref.from).trimEnd() + "\n\n" + indent;
  const inserted = before + header + "\n" + indent + image + (input.forCaption ? editableGap(indent) : "\n") + indent + figureClose;
  const from = line.from + (before.lastIndexOf("\n") + 1);
  const changes = { from: line.from, to: line.to, insert: inserted };
  const next = checked(doc, changes, from, line.from + inserted.length, ref.target);
  if (next && doc.lineAt(owner.from).number === (next.owner.name === "Document" ? 1 : doc.lineAt(next.owner.from).number)) {
    return { changes, cursor: input.forCaption ? next.captionLines.from + 2 + indent.length : undefined };
  }
}

export function changeCrop(figure: Figure, crop?: Crop): FigureChange | undefined {
  const value = cropRecord(crop);
  if (crop && !value && (crop[0] !== 0 || crop[1] !== 0 || crop[2] !== 1 || crop[3] !== 1)) return;
  if (figure.crop?.every((part, i) => part === crop?.[i]) || (!value && !figure.crop)) return;
  const metadata = { ...figure.metadata };
  if (value) {
    const existing = metadata.crop;
    metadata.crop = { ...(existing && typeof existing === "object" ? existing : {}), ...value };
  } else delete metadata.crop;
  return { ...figure.opening, insert: formatOpening(metadata) };
}

