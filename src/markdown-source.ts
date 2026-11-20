import type { Text } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";

const markdown = parser.configure(GFM);
interface Range {
  from: number;
  to: number;
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

function parseSource(source: string) {
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
      if ((comment === "<!-- vml -->" || comment.startsWith("<!-- vml ")) && layoutStart === undefined) layoutStart = node.from;
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

const trees = new WeakMap<Text, Tree>();

export function parseDocument(doc: Text): Tree {
  const cached = trees.get(doc);
  if (cached) return cached;
  const tree = parseSource(doc.toString());
  trees.set(doc, tree);
  return tree;
}
