import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { parseDocument } from "./markdown-source";
import { imageReferences, type ImageReference } from "./image-source";
import type { Crop } from "./crop-state";

export const figureOpen = "live-image-figure";
export const figureClose = "<!-- /live-image-figure -->";
const opening = /^<!-- live-image-figure:v(\d+)(?:[ \t]+(.+?))?[ \t]*-->$/;
const namespace = /^<!-- \/?live-image-figure(?:[: \t]|-->|$)/;
const blockId = /^[ \t]+\^[a-zA-Z0-9-]+[ \t]*$/;

export interface Span {
  from: number;
  to: number;
}

export interface Figure extends Span {
  opening: Span;
  closing: Span;
  image: ImageReference;
  caption: string;
  captionLines: Span;
  metadata: Readonly<Record<string, unknown>>;
  crop?: Crop;
  owner: SyntaxNode;
  indent: number;
  bodyIndent: number;
  ownsBullet: boolean;
}

interface FigureIndex {
  figures: Figure[];
  reserved: Span[];
}

export function columns(prefix: string): number {
  let column = 0;
  for (const character of prefix) column += character === "\t" ? 4 - column % 4 : 1;
  return column;
}

export function removeIndent(text: string, indent: number): string {
  let column = 0;
  let offset = 0;
  while (column < indent && (text[offset] === " " || text[offset] === "\t")) {
    column += text[offset] === "\t" ? 4 - column % 4 : 1;
    offset++;
  }
  return " ".repeat(Math.max(0, column - indent)) + text.slice(offset);
}

export function parentContainer(node: SyntaxNode): SyntaxNode | undefined {
  const parent = node.parent;
  if (parent?.name === "Document") return parent;
  if (parent?.name !== "ListItem") return;
  for (let path = parent.parent; path; path = path.parent) {
    if (!["Document", "BulletList", "ListItem"].includes(path.name)) return;
  }
  return parent;
}

export function listIndent(doc: Text, item: SyntaxNode): number {
  const mark = item.getChild("ListMark");
  if (!mark) return 0;
  const line = doc.lineAt(mark.to);
  const end = columns(doc.sliceString(line.from, mark.to));
  const whitespace = /^[ \t]*/.exec(doc.sliceString(mark.to, line.to))?.[0] ?? "";
  const next = columns(doc.sliceString(line.from, mark.to) + whitespace);
  return end + (next - end >= 1 && next - end <= 4 ? next - end : 1);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function metadataCrop(value: unknown): Crop | undefined {
  if (!record(value)) return;
  const { x, y, width, height } = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number" ||
      ![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
      x + width > 1 + Number.EPSILON || y + height > 1 + Number.EPSILON) return;
  return [x, y, width, height];
}

export function hasOnlyBlockId(tail: string): boolean {
  return blockId.test(tail);
}

export function readMetadata(raw: string): Record<string, unknown> | undefined {
  const match = opening.exec(raw);
  if (match?.[1] !== "1") return;
  try {
    const value: unknown = match[2] ? JSON.parse(match[2]) : {};
    if (record(value) && (!Object.prototype.hasOwnProperty.call(value, "crop") || metadataCrop(value.crop))) return value;
  } catch {
    // Invalid source keeps its native Markdown rendering.
  }
}

function readFigure(doc: Text, start: SyntaxNode, end: SyntaxNode, owner: SyntaxNode): Figure | undefined {
  const first = doc.lineAt(start.from);
  const last = doc.lineAt(end.from);
  const metadata = readMetadata(doc.sliceString(start.from, first.to).trimEnd());
  if (!metadata || last.number <= first.number + 1) return;
  const indent = listIndent(doc, owner);
  const ownsBullet = owner.name === "ListItem" && doc.lineAt(owner.from).number === first.number;
  const imageLine = doc.line(first.number + 1);
  const image = imageReferences(doc).lines.get(imageLine.number)?.[0];
  if (!image || imageReferences(doc).lines.get(imageLine.number)?.length !== 1 ||
      doc.sliceString(imageLine.from, image.from).trim()) return;
  const imageIndent = columns(doc.sliceString(imageLine.from, image.from));
  if (imageIndent < indent) return;
  const suffix = doc.sliceString(image.to, imageLine.to);
  if (suffix.trim() && !hasOnlyBlockId(suffix)) return;
  const rows: string[] = [];
  let bodyIndent = (ownsBullet || columns(doc.sliceString(first.from, start.from)) === imageIndent) &&
    columns(doc.sliceString(last.from, end.from)) === imageIndent ? imageIndent : indent;
  for (let n = imageLine.number + 1; n < last.number; n++) {
    const text = doc.line(n).text;
    if (text.trim()) {
      const whitespace = /^[ \t]*/.exec(text)?.[0] ?? "";
      const width = columns(whitespace);
      if (width < indent) return;
      if (width < bodyIndent) bodyIndent = indent;
    }
    rows.push(text);
  }
  const caption = rows.map(text => text.trim() ? removeIndent(text, bodyIndent) : "");
  while (caption.length && !caption[0].trim()) caption.shift();
  while (caption.length && !caption.at(-1)?.trim()) caption.pop();
  return {
    from: first.from, to: last.to, opening: { from: start.from, to: first.to }, closing: { from: end.from, to: last.to },
    image, owner, indent, bodyIndent, ownsBullet, metadata, crop: metadataCrop(metadata.crop), caption: caption.join("\n"),
    captionLines: { from: imageLine.to, to: last.from }
  };
}

const cache = new WeakMap<Text, FigureIndex>();

export function figureIndex(doc: Text): FigureIndex {
  const found = cache.get(doc);
  if (found) return found;
  const figures: Figure[] = [];
  const reserved: Span[] = [];
  const pending = new Map<string, { node: SyntaxNode; owner: SyntaxNode; nested: boolean }>();
  parseDocument(doc).iterate({
    enter({ name, node }) {
      if (name !== "CommentBlock") return;
      const raw = doc.sliceString(node.from, node.to);
      if (!namespace.test(raw)) return false;
      const owner = parentContainer(node);
      if (!owner) return false;
      const line = doc.lineAt(node.from);
      const isWholeLine = node.to <= line.to && !doc.sliceString(node.to, line.to).trim();
      if (!isWholeLine) {
        reserved.push({ from: line.from, to: node.to });
        return false;
      }
      const key = owner.name + ":" + owner.from;
      const start = pending.get(key);
      if (raw === figureClose) {
        if (start) {
          reserved.push({ from: doc.lineAt(start.node.from).from, to: line.to });
          const figure = !start.nested && readFigure(doc, start.node, node, owner);
          if (figure) figures.push(figure);
          pending.delete(key);
        }
      } else if (start) {
        start.nested = true;
      } else {
        pending.set(key, { node, owner, nested: false });
      }
      return false;
    }
  });
  for (const { node, owner } of pending.values()) {
    reserved.push({ from: doc.lineAt(node.from).from, to: owner.to });
  }
  figures.sort((a, b) => a.from - b.from);
  const valid = figures.filter((figure, i) => (i === 0 || figures[i - 1].to < figure.from) &&
    (i + 1 === figures.length || figures[i + 1].from > figure.to));
  const index = { figures: valid, reserved };
  cache.set(doc, index);
  return index;
}

export function figureAtCaptionOrMarker(doc: Text, position: number): Figure | undefined {
  return figureIndex(doc).figures.find(figure =>
    (position >= figure.opening.from && position <= figure.opening.to) ||
    (position > figure.captionLines.from && position <= figure.closing.to));
}

export function formatOpening(metadata: Readonly<Record<string, unknown>>): string {
  const json = Object.keys(metadata).length ? " " + JSON.stringify(metadata).replace(/-->/g, "\\u002d\\u002d>") : "";
  return `<!-- ${figureOpen}:v1${json} -->`;
}
