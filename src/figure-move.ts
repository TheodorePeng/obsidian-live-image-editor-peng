import { ChangeSet, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { columns, figureIndex, listIndent, type Figure } from "./figure-source";
import { parseDocument } from "./markdown-source";

export type MoveDirection = "up" | "down";

export interface FigureMove {
  changes: ChangeSet;
  imageFrom: number;
  imageTo: number;
}

interface Row {
  text: string;
  original: number;
}

interface Destination {
  scope: SyntaxNode | undefined;
  at: number;
  indent: number;
}

function indentation(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

function rowOf(doc: Text, pos: number): number {
  return doc.lineAt(pos).number - 1;
}

function afterItem(doc: Text, node: SyntaxNode): number {
  return rowOf(doc, Math.max(node.from, node.to - 1)) + 1;
}

function parentOfItem(item: SyntaxNode): SyntaxNode | undefined {
  const parent = item.parent?.parent;
  return parent?.name === "ListItem" ? parent : undefined;
}

function previousItem(doc: Text, figure: Figure): SyntaxNode | undefined {
  if (figure.ownsBullet) return figure.owner.prevSibling ?? undefined;
  let previous: SyntaxNode | undefined;
  for (let node = figure.owner.firstChild; node && node.to <= figure.from; node = node.nextSibling) previous = node;
  if (previous?.name !== "BulletList" || doc.sliceString(previous.to, figure.from).trim()) return;
  const item = previous.lastChild;
  if (item?.name === "ListItem") return item;
}

function destinations(doc: Text, figure: Figure, direction: MoveDirection): Destination[] {
  const { owner, ownsBullet } = figure;
  const at = rowOf(doc, figure.from);
  if (ownsBullet && doc.sliceString(figure.to, owner.to).trim()) return [];
  if (direction === "down") {
    const item = previousItem(doc, figure);
    const mark = item?.getChild("ListMark");
    if (!item || !mark || !doc.sliceString(mark.to, doc.lineAt(mark.to).to).trim() ||
        figureIndex(doc).reserved.some(span => mark.from >= span.from && mark.from < span.to)) return [];
    return [{ scope: item, at, indent: listIndent(doc, item) }];
  }
  if (owner.parent?.name !== "BulletList") return [];
  const parent = parentOfItem(owner);
  if (ownsBullet && !parent) return [];
  const scope = ownsBullet && parent ? parentOfItem(parent) : parent;
  const item = ownsBullet && parent ? parent : owner;
  const indent = scope ? listIndent(doc, scope) : 0;
  const markerIndent = columns(indentation(doc.lineAt(item.from).text));
  const fitsScope = scope && markerIndent >= indent && markerIndent <= indent + 3;
  const preferred = ownsBullet || fitsScope ? markerIndent : indent;
  return [at, afterItem(doc, item)].filter((row, index, all) => all.indexOf(row) === index)
    .map(row => ({ scope, at: row, indent: preferred }));
}

function reindent(text: string, delta: number): string {
  if (!text) return text;
  const whitespace = indentation(text);
  const width = Math.max(0, columns(whitespace) + delta);
  const tabs = whitespace.includes("\t") ? Math.floor(width / 4) : 0;
  return "\t".repeat(tabs) + " ".repeat(width - tabs * 4) + text.slice(whitespace.length);
}

// Use stable source rows to distinguish repeated list labels and identical image references.
function shape(doc: Text, tree: Tree, rows: readonly Row[], at: number, internal?: { start: number; end: number }): string {
  const line = doc.line(at + 1);
  const first = line.from + indentation(line.text).length;
  const path: string[] = [];
  for (let node: SyntaxNode | null = tree.resolveInner(first, 1); node; node = node.parent) {
    if (node.name === "BulletList" || node.name === "Document") continue;
    const original = rows[rowOf(doc, node.from)].original;
    if (internal && (original < internal.start || original > internal.end)) continue;
    path.push(node.name === "ListItem" ? node.name + ":" + original : node.name);
  }
  return path.join("/");
}

export function imageMovesWithChange(from: number, to: number, move: FigureMove): boolean {
  return move.changes.mapPos(from) === move.imageFrom && move.changes.mapPos(to) === move.imageTo;
}

function changesAroundImage(doc: Text, next: Text, figure: Figure, moved: Figure): FigureMove {
  const before = next.sliceString(0, moved.image.from);
  const after = next.sliceString(moved.image.to);
  const oldBefore = doc.sliceString(0, figure.image.from);
  const oldAfter = doc.sliceString(figure.image.to);
  let prefix = 0;
  while (prefix < before.length && before[prefix] === oldBefore[prefix]) prefix++;
  let suffix = 0;
  while (suffix < after.length && after[after.length - 1 - suffix] === oldAfter[oldAfter.length - 1 - suffix]) suffix++;
  const changes = ChangeSet.of([
    { from: prefix, to: figure.image.from, insert: before.slice(prefix) },
    { from: figure.image.to, to: doc.length - suffix, insert: after.slice(0, after.length - suffix) }
  ], doc.length);
  return { changes, imageFrom: moved.image.from, imageTo: moved.image.to };
}

export function moveFigure(doc: Text, figure: Figure, direction: MoveDirection): FigureMove | undefined {
  const targets = destinations(doc, figure, direction);
  if (!targets.length) return;
  const rows = doc.toString().split("\n").map((text, original) => ({ text, original }));
  const start = rowOf(doc, figure.from);
  const end = rowOf(doc, figure.to);
  const movedRows = rows.slice(start, end + 1);
  const external = [...rows.slice(0, start), ...rows.slice(end + 1)];
  const tree = parseDocument(doc);
  const active = figureIndex(doc).figures;
  const base = columns(indentation(rows[start].text));
  for (const target of targets) {
    const delta = target.indent - base;
    if (!delta || movedRows.some(row => row.text.trim() && columns(indentation(row.text)) + delta < 0)) continue;
    const moved = movedRows.map(row => ({ ...row, text: reindent(row.text, delta) }));
    const at = target.at > end ? target.at - moved.length : target.at;
    const expectedOwner = target.scope ? rowOf(doc, target.scope.from) : undefined;
    const blank = { text: "", original: -1 };
    for (const [before, after] of [[false, false], [true, false], [false, true], [true, true]]) {
      const movedAt = at + Number(before);
      const candidate = [...external.slice(0, at), ...(before ? [blank] : []), ...moved,
        ...(after ? [blank] : []), ...external.slice(at)];
      const next = Text.of(candidate.map(row => row.text));
      const figures = figureIndex(next).figures;
      if (figures.length !== active.length) continue;
      const relocated = figures.find(item => rowOf(next, item.from) === movedAt);
      if (!relocated || rowOf(next, relocated.to) !== movedAt + moved.length - 1 ||
          relocated.ownsBullet !== figure.ownsBullet ||
          next.sliceString(relocated.image.from, relocated.image.to) !== doc.sliceString(figure.image.from, figure.image.to)) continue;
      const parent = relocated.ownsBullet ? parentOfItem(relocated.owner) : relocated.owner;
      const actualOwner = parent && parent.name !== "Document" ? candidate[rowOf(next, parent.from)].original : undefined;
      if (actualOwner !== expectedOwner) continue;
      const nextTree = parseDocument(next);
      const coherent = candidate.every((row, index) => {
        if (!row.text.trim()) return true;
        const internal = row.original >= start && row.original <= end ? { start, end } : undefined;
        return shape(doc, tree, rows, row.original, internal) === shape(next, nextTree, candidate, index, internal);
      });
      if (coherent) return changesAroundImage(doc, next, figure, relocated);
    }
  }
}
