import { isolateHistory } from "@codemirror/commands";
import { ChangeSet, type ChangeSpec, type Text, type Transaction, type TransactionSpec } from "@codemirror/state";
import { captionIndex, columns, removeIndent, type CaptionSource, type ImageSource } from "./caption-source";

export type IndentDirection = 1 | -1;

function leadingSpace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

function prefixAtColumn(prefix: string, target: number): string {
  let end = 0;
  let column = 0;
  while (end < prefix.length) {
    const next = prefix[end] === "\t" ? column + 4 - column % 4 : column + 1;
    if (next > target) break;
    column = next;
    end++;
  }
  return prefix.slice(0, end) + " ".repeat(target - column);
}

function hasOnlyIndentChanges(transaction: Transaction, imageLine: number, direction: IndentDirection): boolean {
  const before = transaction.startState.doc;
  const { newDoc, changes } = transaction;
  if (before.lines !== newDoc.lines) return false;
  let indentOnly = true;
  changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
    const line = before.lineAt(from);
    if (to > line.from + leadingSpace(line.text).length || inserted.lines !== 1 || /[^ \t]/.test(inserted.toString())) {
      indentOnly = false;
    }
  });
  const delta = columns(leadingSpace(newDoc.line(imageLine).text)) -
    columns(leadingSpace(before.line(imageLine).text));
  return indentOnly && Math.sign(delta) === direction;
}

function originalCaptionAt(doc: Text, image: ImageSource, caption: CaptionSource): boolean {
  const paired = captionIndex(doc).captionedImages.get(image.from);
  return paired?.closed === true && paired.format === caption.format && paired.openLine === caption.openLine &&
    paired.endLine === caption.endLine && paired.body === caption.body;
}

function reindentCaption(
  before: Text,
  after: Text,
  caption: CaptionSource,
  previousImage: ImageSource,
  nextImage: ImageSource
): ChangeSpec[] | undefined {
  const delta = nextImage.indent - previousImage.indent;
  const opening = columns(leadingSpace(before.line(caption.openLine).text));
  const preferred = leadingSpace(after.line(nextImage.line).text);
  const changes: ChangeSpec[] = [];
  for (let n = caption.openLine; n <= caption.endLine; n++) {
    const old = before.line(n).text;
    const current = after.line(n);
    const indent = leadingSpace(old);
    const column = columns(indent);
    let target = old;
    if (old.length) {
      if (column + delta < 0) {
        if (old.trim()) return;
        target = "";
      } else if (n > caption.openLine && n < caption.endLine && column >= opening) {
        // Reconstruct the outer indentation while preserving the exact parsed Markdown body.
        target = prefixAtColumn(preferred, opening + delta) + removeIndent(old, opening).content;
      } else {
        target = prefixAtColumn(preferred, column + delta) + old.slice(indent.length);
      }
    }
    if (target === current.text) continue;
    const sourcePrefix = leadingSpace(current.text);
    const targetPrefix = leadingSpace(target);
    if (current.text.slice(sourcePrefix.length) !== target.slice(targetPrefix.length)) return;
    changes.push({ from: current.from, to: current.from + sourcePrefix.length, insert: targetPrefix });
  }
  return changes;
}

export function synchronizeCaptionIndent(transaction: Transaction, direction: IndentDirection): TransactionSpec | readonly TransactionSpec[] {
  if (!transaction.docChanged || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
  const { doc, selection } = transaction.startState;
  if (selection.ranges.length !== 1) return transaction;
  const selected = selection.main;
  const line = doc.lineAt(selected.from);
  if (selected.to > line.to) return transaction;
  const index = captionIndex(doc);
  const image = index.images.get(line.number);
  if (!image?.unordered) return transaction;
  const caption = index.captionedImages.get(image.from);
  if (!caption?.closed || !hasOnlyIndentChanges(transaction, line.number, direction)) return transaction;

  const { newDoc } = transaction;
  const nextImage = captionIndex(newDoc).images.get(line.number);
  if (!nextImage?.unordered || doc.sliceString(image.from, image.to) !== newDoc.sliceString(nextImage.from, nextImage.to)) {
    return {};
  }
  const history = isolateHistory.of("full");
  if (originalCaptionAt(newDoc, nextImage, caption)) return [transaction, { annotations: history }];

  const repairs = reindentCaption(doc, newDoc, caption, image, nextImage);
  if (!repairs?.length) return {};
  const repairSet = ChangeSet.of(repairs, newDoc.length);
  if (!originalCaptionAt(repairSet.apply(newDoc), nextImage, caption)) return {};
  return [transaction, { changes: repairSet, sequential: true, annotations: history }];
}
