import { ChangeSet, Text } from "@codemirror/state";
import { leadingWhitespace, reindentFigureLine } from "./figure-indent";
import { columns, figureClose, figureIndex, hasOnlyBlockId, parentContainer, readMetadata, type Span } from "./figure-source";
import { imageReferences } from "./image-source";
import { parseDocument } from "./markdown-source";

type Marker = { line: number; kind: "open" | "close" | "invalid" | "bullet" };
export type RepairResult = { changes: ChangeSet; span: Span } | { message: string };

const selectionMessage = "请选择一个完整图块，从开头注释到结束注释。";

function insideFence(doc: Text, at: number): boolean {
  for (let node = parseDocument(doc).resolveInner(at, 1); node; ) {
    if (node.name === "FencedCode") return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

function markers(doc: Text, first: number, last: number): Marker[] {
  const result: Marker[] = [];
  for (let line = first; line <= last; line++) {
    const row = doc.line(line);
    const match = /^([ \t]*(?:[-+*][ \t]+)?)(<!-- \/?live-image-figure(?=[: \t]|-->|$).*)$/.exec(row.text);
    if (!match || insideFence(doc, row.from + match[1].length)) continue;
    const label = match[2].trimEnd();
    const kind = match[1].trim() ? "bullet" :
      label === figureClose ? "close" : readMetadata(label) ? "open" : "invalid";
    result.push({ line, kind });
  }
  return result;
}

function fullLines(doc: Text, from: number, to: number) {
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  const end = last.from === to && last.number > first.number ? doc.line(last.number - 1) : last;
  if (doc.sliceString(first.from, from).trim() || (end === last && doc.sliceString(to, end.to).trim())) return;
  return { first, last: end };
}

function outsideShape(doc: Text, first: number, last: number): string[] {
  const tree = parseDocument(doc);
  const result: string[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (n >= first && n <= last) continue;
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    const path: string[] = [];
    for (let node = tree.resolveInner(line.from + leadingWhitespace(line.text).length, 1); node; ) {
      if (node.name !== "BulletList" && node.name !== "Document") {
        path.push(node.name === "ListItem" ? "ListItem:" + doc.lineAt(node.from).number : node.name);
      }
      if (!node.parent) break;
      node = node.parent;
    }
    result.push(path.join("/"));
  }
  return result;
}

function normalizedCaption(rows: readonly string[], base: number): string[] {
  const normalized: string[] = [];
  for (const row of rows) {
    if (!row.trim()) {
      normalized.push("");
      continue;
    }
    const width = columns(leadingWhitespace(row));
    normalized.push(" ".repeat(Math.max(0, width - base)) + row.trimStart());
  }
  return normalized;
}

export function repairFigure(doc: Text, from: number, to: number): RepairResult {
  const range = from < to && fullLines(doc, from, to);
  if (!range) return { message: selectionMessage };
  const { first, last } = range;
  const boundaries = markers(doc, first.number, last.number);
  if (boundaries.length !== 2 || boundaries[0].line !== first.number || boundaries[1].line !== last.number ||
      boundaries[1].kind !== "close" || last.number < first.number + 2) return { message: selectionMessage };
  if (boundaries[0].kind === "bullet") return { message: "旧式 Bullet 图块请使用图片菜单中的对齐列表缩进。" };
  if (boundaries[0].kind !== "open") return { message: "无法识别开头注释中的图块版本或参数。" };

  const image = doc.line(first.number + 1);
  const rawImage = image.text.trimStart();
  const isolated = Text.of([rawImage]);
  const images = imageReferences(isolated).references;
  if (images.length !== 1 || images[0].from !== 0 ||
      (rawImage.slice(images[0].to).trim() && !hasOnlyBlockId(rawImage.slice(images[0].to)))) {
    return { message: "开头注释的下一行应只有一张图片。" };
  }

  const prefix = leadingWhitespace(first.text);
  const imageBase = columns(leadingWhitespace(image.text));
  const closingBase = columns(leadingWhitespace(last.text));
  const current = figureIndex(doc).figures.find(figure => figure.from === first.from && figure.to === last.to);
  const rows: string[] = [];
  for (let n = image.number + 1; n < last.number; n++) rows.push(doc.line(n).text);
  const targetBase = columns(prefix);
  let minBase = Infinity;
  for (const row of rows) {
    if (row.trim()) minBase = Math.min(minBase, columns(leadingWhitespace(row)));
  }
  if (!Number.isFinite(minBase)) minBase = imageBase;
  const base = current?.bodyIndent ?? (imageBase === closingBase ? imageBase :
    [imageBase, closingBase].includes(targetBase) ? targetBase : minBase);
  const relative = normalizedCaption(rows, base);
  let structured = false;
  parseDocument(Text.of(relative)).iterate({
    enter({ name }) {
      if (["BulletList", "OrderedList", "Blockquote", "FencedCode", "CodeBlock"].includes(name)) structured = true;
    }
  });
  if (structured && (minBase < base || (!current && imageBase !== closingBase &&
      ![imageBase, closingBase].includes(targetBase) && ![imageBase, closingBase].includes(minBase)))) {
    return { message: "图注包含缩进不明确的列表、引用或代码，请先调整这些行。" };
  }

  const edits = [];
  for (let n = image.number; n <= last.number; n++) {
    const line = doc.line(n);
    const leading = leadingWhitespace(line.text);
    if (!line.text.trim()) continue;
    const next = n === image.number || n === last.number || columns(leading) < base
      ? prefix + line.text.slice(leading.length)
      : reindentFigureLine(line.text, base, prefix);
    if (next === undefined) return { message: "无法确认图注的内部缩进。" };
    const updated = leadingWhitespace(next);
    if (updated !== leading) edits.push({ from: line.from, to: line.from + leading.length, insert: updated });
  }
  const changes = ChangeSet.of(edits, doc.length);
  const next = changes.apply(doc);
  const span = { from: first.from, to: changes.mapPos(last.to) };
  const figure = figureIndex(next).figures.find(item => item.from === span.from && item.to === span.to);
  const opening = parseDocument(doc).resolve(first.from + prefix.length, 1);
  const owner = current?.owner ?? (opening.name === "CommentBlock" ? parentContainer(opening) : undefined);
  if (!figure || next.lineAt(figure.image.from).text.trimStart() !== rawImage ||
      (owner && (owner.name !== figure.owner.name || owner.from !== figure.owner.from)) ||
      outsideShape(doc, first.number, last.number).join("\n") !== outsideShape(next, first.number, last.number).join("\n")) {
    return { message: "当前开头位置无法安全修复图块，请核对它所属的列表项。" };
  }
  const expected = relative.join("\n").replace(/^\n+|\n+$/g, "");
  if (normalizedCaption(figure.caption.split("\n"), 0).join("\n") !== expected) {
    return { message: "修复会改变图注内部结构，请先检查图注缩进。" };
  }
  return { changes, span };
}

export function figureSourceSpan(doc: Text, from: number, to = from): Span | undefined {
  const { figures } = figureIndex(doc);
  if (from !== to) {
    const selected = fullLines(doc, from, to);
    if (!selected) return;
    const span = { from: selected.first.from, to: selected.last.to };
    if (figures.some(figure => figure.from === span.from && figure.to === span.to) ||
        "changes" in repairFigure(doc, from, to)) return span;
    return;
  }
  const valid = figures.find(figure => from >= figure.from && from <= figure.to);
  if (valid) return { from: valid.from, to: valid.to };
  const boundaries = markers(doc, 1, doc.lines);
  const cursor = doc.lineAt(from).number;
  const open = boundaries.findLastIndex(mark => mark.line <= cursor && mark.kind !== "close");
  const end = boundaries[open + 1];
  const start = boundaries[open];
  if (start?.kind !== "open" || end?.kind !== "close" || end.line < cursor) return;
  const span = { from: doc.line(start.line).from, to: doc.line(end.line).to };
  if ("changes" in repairFigure(doc, span.from, span.to)) return span;
}
