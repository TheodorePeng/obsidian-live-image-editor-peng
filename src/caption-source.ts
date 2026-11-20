import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";

export const captionLanguage = "image-caption";
const markdown = parser.configure(GFM);
const imageExtension = /\.(?:avif|bmp|gif|heic|ico|jpe?g|png|svg|tiff?|webp)$/i;

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
}

export interface CaptionSource {
  container: string;
  openLine: number;
  endLine: number;
  closed: boolean;
  body: string;
  input: number;
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

export function removeIndent(text: string, indent: number): { content: string; offset: number } {
  let column = 0;
  let offset = 0;
  while (column < indent && (text[offset] === " " || text[offset] === "\t")) {
    column += text[offset] === "\t" ? 4 - column % 4 : 1;
    offset++;
  }
  return { content: " ".repeat(Math.max(0, column - indent)) + text.slice(offset), offset };
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

function maskRanges(source: string, ranges: Range[]): string {
  let result = "";
  let from = 0;
  for (const range of ranges) {
    result += source.slice(from, range.from) + source.slice(range.from, range.to).replace(/[^\r\n]/g, " ");
    from = range.to;
  }
  return result + source.slice(from);
}

function parseDocument(source: string) {
  const frontmatter = /^(?:\uFEFF)?---[ \t]*\n[\s\S]*?^---[ \t]*(?=\n|$)/m.exec(source);
  let parsedSource = frontmatter?.index === 0
    ? maskRanges(source, [{ from: 0, to: frontmatter[0].length }])
    : source;

  const comments = parsedSource.includes("%%") ? obsidianCommentRanges(parsedSource) : [];
  if (comments.length) parsedSource = maskRanges(parsedSource, comments);
  const tree = markdown.parse(parsedSource);
  if (!parsedSource.includes("<!-- vml")) return tree;

  const layouts: Range[] = [];
  let layoutStart: number | undefined;
  tree.iterate({
    enter(node) {
      if (node.name !== "CommentBlock") return;
      const comment = parsedSource.slice(node.from, node.to).trim();
      if (comment.startsWith("<!-- vml ") && layoutStart === undefined) layoutStart = node.from;
      if (comment === "<!-- /vml -->" && layoutStart !== undefined) {
        layouts.push({ from: layoutStart, to: node.to });
        layoutStart = undefined;
      }
    }
  });
  return layouts.length ? markdown.parse(maskRanges(parsedSource, layouts)) : tree;
}

function obsidianCommentRanges(source: string): Range[] {
  const tree = markdown.parse(source);
  const opaque: Range[] = [];
  tree.iterate({
    enter(node) {
      if (!["FencedCode", "CodeBlock", "InlineCode", "CommentBlock", "Comment", "HTMLBlock", "URL"].includes(node.name)) return;
      opaque.push({ from: node.from, to: node.to });
      return false;
    }
  });
  const comments: Range[] = [];
  let opening = -1;
  let nextOpaque = 0;
  for (const match of source.matchAll(/%%/g)) {
    const offset = match.index;
    if (opening >= 0) {
      comments.push({ from: opening, to: offset + 2 });
      opening = -1;
      continue;
    }
    while (opaque[nextOpaque] && opaque[nextOpaque].to <= offset) nextOpaque++;
    if (!opaque[nextOpaque] || opaque[nextOpaque].from > offset) opening = offset;
  }
  if (opening >= 0) comments.push({ from: opening, to: source.length });
  return comments;
}

function paragraphImages(doc: Text, paragraph: SyntaxNode, parent: SyntaxNode, images: Map<number, ImageSource>): void {
  const first = doc.lineAt(paragraph.from);
  const last = doc.lineAt(paragraph.to);
  const indent = listIndent(doc, parent);
  const container = containerKey(parent);
  const unordered = parent.parent?.name === "BulletList";
  const markdownImages = new Map<number, { to: number; target: string }>();
  for (let child = paragraph.firstChild; child; child = child.nextSibling) {
    if (child.name === "Image" && child.getChildren("LinkMark").some(mark => doc.sliceString(mark.from, mark.to) === "(")) {
      const url = child.getChild("URL");
      if (url) {
        const target = doc.sliceString(url.from, url.to).replace(/^<|>$/g, "");
        markdownImages.set(child.from, { to: child.to, target });
      }
    }
  }

  for (let number = first.number; number <= last.number; number++) {
    const line = doc.line(number);
    const start = number === first.number ? paragraph.from - line.from : 0;
    const leading = /^[ \t]*/.exec(line.text.slice(start))?.[0].length ?? 0;
    const from = line.from + start + leading;
    const content = line.text.slice(start + leading).trimEnd();
    if (from + content.length > paragraph.to) continue;
    const to = from + content.length;
    if (number !== first.number && columns(line.text.slice(0, leading)) < indent) continue;
    const wikiTarget = /^!\[\[([^[\]]+)\]\]$/.exec(content)?.[1]?.split(/[|#]/, 1)[0]?.trim();
    const standard = markdownImages.get(from);
    const target = wikiTarget && imageExtension.test(wikiTarget) ? wikiTarget :
      standard?.to === to ? standard.target : undefined;
    if (target) images.set(number, { from, to, line: number, indent, container, target, unordered });
  }
}

function readCaption(doc: Text, fence: SyntaxNode, parent: SyntaxNode): CaptionSource | undefined {
  const info = fence.getChild("CodeInfo");
  if (!info || doc.sliceString(info.from, info.to).trim() !== captionLanguage) return;
  const open = doc.lineAt(fence.from);
  const marks = fence.getChildren("CodeMark");
  const closed = marks.length === 2;
  const end = doc.lineAt(fence.to);
  const lines: string[] = [];
  const indent = columns(doc.sliceString(open.from, fence.from));
  let input = open.to;
  if (closed) {
    for (let number = open.number + 1; number < end.number; number++) {
      const line = doc.line(number);
      const { content, offset } = removeIndent(line.text, indent);
      if (number === open.number + 1) input = line.from + offset;
      lines.push(content);
    }
  }
  return {
    openLine: open.number, endLine: end.number, container: containerKey(parent), closed, input, body: lines.join("\n")
  };
}

const indexes = new WeakMap<Text, CaptionIndex>();

export function captionIndex(doc: Text): CaptionIndex {
  const cached = indexes.get(doc);
  if (cached) return cached;

  const images = new Map<number, ImageSource>();
  const captions = new Map<number, CaptionSource>();
  const captionedImages = new Map<number, CaptionSource>();
  parseDocument(doc.toString()).iterate({
    enter({ name, node }) {
      if (name !== "Paragraph" && name !== "FencedCode") return;
      const container = containingBlock(node);
      if (!container) return false;
      if (name === "Paragraph") {
        paragraphImages(doc, node, container, images);
      } else {
        const caption = readCaption(doc, node, container);
        if (caption) captions.set(caption.openLine, caption);
      }
      return false;
    }
  });

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
  const prefix = "\n" + indent + "```" + captionLanguage + "\n" + indent;
  const separation = image.line < doc.lines && doc.line(image.line + 1).text.trim() ? "\n" : "";
  return { from, cursor: from + prefix.length, insert: prefix + "\n" + indent + "```" + separation };
}
