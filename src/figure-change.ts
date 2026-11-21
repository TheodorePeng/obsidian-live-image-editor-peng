import { ChangeSet, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { type Crop } from "./crop-state";
import { columns, figureClose, figureIndex, formatOpening, hasOnlyBlockId,
  metadataCrop, parentContainer, type Figure, type Span } from "./figure-source";
import { figureBodyPrefix, leadingWhitespace, listContentPrefix, reindentFigureLine } from "./figure-indent";
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

function checked(doc: Text, from: number, to: number, target: string): Figure | undefined {
  const figure = figureIndex(doc).figures.find(candidate => candidate.from === from && candidate.to === to);
  if (figure?.image.target === target) return figure;
}

function listOwnership(doc: Text, mapLine: (line: number) => number | undefined): string[] {
  const owners: (number | undefined)[] = [];
  const result: string[] = [];
  parseDocument(doc).iterate({
    enter({ name, node }) {
      if (name !== "ListItem") return;
      const marker = node.getChild("ListMark");
      const line = mapLine(doc.lineAt(node.from).number);
      const bullet = marker ? doc.sliceString(marker.from, marker.to) : "";
      if (line !== undefined) result.push([line, bullet, ...owners].join(":"));
      owners.push(line);
    },
    leave({ name }) {
      if (name === "ListItem") owners.pop();
    }
  });
  return result;
}

function preservesListOwnership(before: Text, after: Text, mapLine: (line: number) => number | undefined = line => line): boolean {
  const expected = listOwnership(before, mapLine);
  const actual = listOwnership(after, line => line);
  return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
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
    if (columns(line.text) >= columns(figureBodyPrefix(doc, figure))) return line.to;
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
  const indent = figureBodyPrefix(doc, figure);
  const image = doc.lineAt(figure.image.from);
  const close = doc.lineAt(figure.closing.from);
  const existingRows = close.number - image.number - 1;
  let at: number;
  let insert: string;
  let cursor: number;
  if (existingRows >= 3) {
    const line = doc.line(image.number + 2);
    at = line.to;
    insert = line.text ? " ".repeat(columns(indent) - columns(line.text)) : indent;
    cursor = at + insert.length;
  } else {
    at = existingRows === 2 ? doc.line(image.number + 2).from : close.from;
    const leading = existingRows === 0 ? "\n" : "";
    insert = leading + indent + (existingRows === 2 ? "\n" : "\n\n");
    cursor = at + leading.length + indent.length;
  }
  const changes = { from: at, to: at, insert };
  const next = doc.replace(at, at, Text.of(insert.split("\n")));
  if (checked(next, figure.from, figure.to + insert.length, figure.image.target)) return { changes, cursor };
}

export function insertAfterFigure(doc: Text, figure: Figure): FigureEdit {
  const close = doc.lineAt(figure.closing.from);
  const indent = figure.owner.name === "ListItem" ? leadingWhitespace(close.text) : "";
  const insert = "\n" + indent;
  return { changes: { from: close.to, to: close.to, insert }, cursor: close.to + insert.length };
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

export function wrapImage(doc: Text, ref: ImageReference, input: { crop?: Crop; forCaption?: boolean }, unit = "  "): FigureEdit | undefined {
  if (!canWrapImage(doc, ref)) return;
  const crop = cropRecord(input.crop);
  if (!crop && !input.forCaption) return;
  const line = doc.lineAt(ref.from);
  const paragraph = firstParagraph(doc, ref);
  const owner = paragraph && parentContainer(paragraph);
  if (!owner || !paragraph) return;
  const prefix = doc.sliceString(Math.max(paragraph.from, line.from), ref.from);
  const bareBullet = owner.name === "ListItem" && doc.lineAt(owner.from).number === line.number && !prefix.trim();
  const removeBullet = bareBullet && !doc.sliceString(line.to, owner.to).trim();
  const container = removeBullet ? owner.parent?.parent : owner;
  if (!container) return;
  const preferred = listContentPrefix(doc, container, unit);
  const existingPrefix = doc.sliceString(line.from, ref.from);
  const indent = /^[ \t]*$/.test(existingPrefix) && columns(existingPrefix) === columns(preferred) ? existingPrefix : preferred;
  const header = formatOpening(crop ? { crop } : {});
  const image = doc.sliceString(ref.from, line.to);
  let before = indent;
  if (bareBullet && !removeBullet) before = existingPrefix.trimEnd() + "\n" + indent;
  else if (prefix.trim()) before = existingPrefix.trimEnd() + "\n" + indent;
  const inserted = before + header + "\n" + indent + image + (input.forCaption ? editableGap(indent) : "\n") + indent + figureClose;
  const from = line.from + (before.lastIndexOf("\n") + 1);
  const changes = { from: line.from, to: line.to, insert: inserted };
  const replacement = Text.of(inserted.split("\n"));
  const next = doc.replace(changes.from, changes.to, replacement);
  const figure = checked(next, from, line.from + inserted.length, ref.target);
  if (figure?.owner.name !== container.name ||
      (container.name === "ListItem" && doc.lineAt(container.from).number !== next.lineAt(figure.owner.from).number) ||
      !preservesListOwnership(doc, next, number => {
        if (number === line.number && removeBullet) return;
        return number > line.number ? number + replacement.lines - 1 : number;
      })) return;
  return { changes, cursor: input.forCaption ? figure.captionLines.from + 2 + indent.length : undefined };
}

export function alignFigureIndent(doc: Text, figure: Figure, unit: string): readonly FigureChange[] | undefined {
  if (figure.owner.name !== "ListItem") return;
  const preferred = listContentPrefix(doc, figure.owner, unit);
  const previous = figureBodyPrefix(doc, figure);
  const oldBase = columns(previous);
  const open = doc.lineAt(figure.opening.from).number;
  const image = doc.lineAt(figure.image.from).number;
  const close = doc.lineAt(figure.closing.from).number;
  const changes: FigureChange[] = [];
  for (let n = open; n <= close; n++) {
    const line = doc.line(n);
    if ((n === open && figure.ownsBullet) || !line.text) continue;
    const whitespace = leadingWhitespace(line.text);
    const boundary = n === open || n === image || n === close;
    // A visually aligned authored prefix needs no repair.
    if (boundary && columns(whitespace) === columns(preferred)) continue;
    const updated = boundary ? preferred + line.text.slice(whitespace.length) :
      reindentFigureLine(line.text, oldBase, preferred);
    if (updated === undefined) return;
    const indent = leadingWhitespace(updated);
    if (indent !== whitespace && (boundary || oldBase !== columns(preferred))) {
      changes.push({ from: line.from, to: line.from + whitespace.length, insert: indent });
    }
  }
  if (!changes.length) return;
  const change = ChangeSet.of(changes, doc.length);
  const next = change.apply(doc);
  const aligned = checked(next, figure.from, change.mapPos(figure.to), figure.image.target);
  if (!aligned || figure.owner.from !== aligned.owner.from || figure.ownsBullet !== aligned.ownsBullet ||
      !preservesListOwnership(doc, next)) return;
  const visualIndent = (text: string) => text.replace(/^[ \t]+/gm, prefix => " ".repeat(columns(prefix)));
  if (visualIndent(figure.caption) !== visualIndent(aligned.caption)) return;
  return changes;
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

