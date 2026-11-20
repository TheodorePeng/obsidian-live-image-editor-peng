import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { parseDocument } from "./markdown-source";
import { imageReferences } from "./image-source";

export const captionStart = "<!-- image-caption:start -->";
export const captionEnd = "<!-- image-caption:end -->";

interface Range {
  from: number;
  to: number;
}

export interface ImageSource extends Range {
  line: number;
  container: string;
  indent: number;
  target: string;
  unordered: boolean;
  ownerLine: number;
}

export interface CaptionSource {
  blocks?: readonly string[];
  terminal?: boolean;
  container: string;
  openLine: number;
  endLine: number;
  closed: boolean;
  body: string;
  image?: ImageSource;
}

interface CaptionIndex {
  images: Map<number, ImageSource>;
  captions: Map<number, CaptionSource>;
  captionedImages: Map<number, CaptionSource>;
}

export function columns(prefix: string): number {
  let column = 0;
  for (const character of prefix) {
    column += character === "\t" ? 4 - column % 4 : 1;
  }
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

function containingBlock(node: SyntaxNode): SyntaxNode | null {
  const parent = node.parent;
  if (parent?.name === "Document") return parent;
  if (parent?.name !== "ListItem") return null;
  for (let ancestor = parent.parent; ancestor; ancestor = ancestor.parent) {
    if (!["BulletList", "OrderedList", "ListItem", "Document"].includes(ancestor.name)) return null;
  }
  return parent;
}

function containerKey(node: SyntaxNode): string {
  return `${node.name}:${node.from}`;
}

function listIndent(doc: Text, item: SyntaxNode): number {
  const marker = item.getChild("ListMark");
  if (!marker) return 0;
  const line = doc.lineAt(marker.from);
  const markerEnd = marker.to - line.from;
  const markerColumn = columns(line.text.slice(0, markerEnd));
  const padding = /^[ \t]+/.exec(line.text.slice(markerEnd))?.[0] ?? "";
  const width = columns(line.text.slice(0, markerEnd + padding.length)) - markerColumn;
  return markerColumn + (width >= 1 && width <= 4 ? width : 1);
}

function paragraphImages(doc: Text, paragraph: SyntaxNode, parent: SyntaxNode, images: Map<number, ImageSource>): void {
  const first = doc.lineAt(paragraph.from);
  const last = doc.lineAt(paragraph.to);
  const indent = listIndent(doc, parent);
  const container = containerKey(parent);
  const unordered = parent.parent?.name === "BulletList";
  const ownerLine = parent.name === "ListItem" ? doc.lineAt(parent.from).number : 0;
  for (let number = first.number; number <= last.number; number++) {
    const line = doc.line(number);
    const start = number === first.number ? paragraph.from - line.from : 0;
    const leading = /^[ \t]*/.exec(line.text.slice(start))?.[0].length ?? 0;
    const from = line.from + start + leading;
    const reference = imageReferences(doc).lines.get(number)?.find(image => image.from === from);
    if (!reference || reference.to > paragraph.to ||
        doc.sliceString(reference.marker?.to ?? reference.to, line.to).trim()) continue;
    if (number !== first.number && columns(line.text.slice(0, leading)) < indent) continue;
    const { to, target } = reference;
    images.set(number, { from, to, line: number, indent, container, target, unordered, ownerLine });
  }
}

function commentCaption(doc: Text, start: SyntaxNode, end: SyntaxNode | undefined, container: string): CaptionSource {
  const opening = doc.lineAt(start.from);
  const openLine = opening.number;
  const endLine = end ? doc.lineAt(end.from).number : openLine;
  const indent = columns(doc.sliceString(opening.from, start.from));
  const lines = [];
  for (let n = openLine + 1; n < endLine; n++) {
    const line = doc.line(n);
    lines.push(removeIndent(line.text, indent));
  }
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  const blocks = [];
  for (let node = start.nextSibling; node && end && node.from < end.from; node = node.nextSibling) {
    const raw = doc.sliceString(node.from, node.to);
    if (node.name !== "CommentBlock") blocks.push(node.name === "Paragraph" && /^\$\$(?:[ \t]|\n|$)/.test(raw) ? "Math" : node.name);
  }
  // Obsidian treats a closing comment immediately after a list as a lazy continuation of its last item.
  const needsSeparator = ["BulletList", "OrderedList"].includes(blocks.at(-1) ?? "");
  const closed = !!end && (!needsSeparator || !doc.line(endLine - 1).text.trim());
  return { openLine, endLine, closed, container, body: lines.join("\n"), blocks, terminal: closed && !end?.nextSibling };
}

const indexes = new WeakMap<Text, CaptionIndex>();

export function captionIndex(doc: Text): CaptionIndex {
  const cached = indexes.get(doc);
  if (cached) return cached;

  const images = new Map<number, ImageSource>();
  const captions = new Map<number, CaptionSource>();
  const captionedImages = new Map<number, CaptionSource>();
  const starts = new Map<string, SyntaxNode>();
  const ambiguous = new Set<string>();
  parseDocument(doc).iterate({
    enter({ name, node }) {
      if (name !== "Paragraph" && name !== "CommentBlock") return;
      const container = containingBlock(node);
      if (!container) return false;
      if (name === "Paragraph") {
        paragraphImages(doc, node, container, images);
      } else {
        const line = doc.lineAt(node.from);
        const marker = line.text.trim();
        if (doc.sliceString(node.from, node.to).trim() !== marker) return false;
        const key = containerKey(container);
        if (marker === captionStart) {
          if (starts.has(key)) ambiguous.add(key);
          const pending = commentCaption(doc, node, undefined, key);
          captions.set(pending.openLine, pending);
          starts.set(key, node);
        } else if (marker === captionEnd) {
          const start = starts.get(key);
          if (start && !ambiguous.has(key)) {
            const closed = commentCaption(doc, start, node, key);
            captions.set(closed.openLine, closed);
          }
          starts.delete(key);
          ambiguous.delete(key);
        }
      }
      return false;
    }
  });

  let enclosing: CaptionSource | undefined;
  for (const caption of captions.values()) {
    if (enclosing && enclosing.endLine >= caption.openLine) {
      // A second layout inside a caption is ambiguous. Leave both as native content.
      caption.closed = false;
      enclosing.closed = false;
      continue;
    }
    if (caption.closed) enclosing = caption;
  }
  for (const caption of captions.values()) {
    let previous = caption.openLine - 1;
    while (previous > 0 && !doc.line(previous).text.trim()) previous--;
    const image = images.get(previous);
    if (image?.container !== caption.container) continue;
    caption.image = image;
    captionedImages.set(image.from, caption);
  }

  const index = { images, captions, captionedImages };
  indexes.set(doc, index);
  return index;
}

export function captionInsertion(doc: Text, image: ImageSource): { from: number; insert: string; cursor: number } {
  const from = doc.line(image.line).to;
  const indent = " ".repeat(image.indent);
  const prefix = "\n" + indent + captionStart + "\n" + indent;
  const ending = "\n" + indent + captionEnd;
  const separation = image.line < doc.lines && doc.line(image.line + 1).text.trim() ? "\n" : "";
  return { from, cursor: from + prefix.length, insert: prefix + "\n" + ending + separation };
}
