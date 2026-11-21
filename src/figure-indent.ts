import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { columns, listIndent, removeIndent, type Figure } from "./figure-source";

export function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

export function listContentPrefix(doc: Text, owner: SyntaxNode, unit: string): string {
  if (owner.name !== "ListItem") return "";
  const prefix = leadingWhitespace(doc.lineAt(owner.from).text);
  const minimum = listIndent(doc, owner);
  const step = /^[ \t]+$/.test(unit) ? unit : "  ";
  let preferred = prefix + step;
  while (columns(preferred) < minimum) preferred += step;
  // Four columns beyond the list content column can start an indented code block.
  return columns(preferred) < minimum + 4 ? preferred : prefix + " ".repeat(minimum - columns(prefix));
}

export function figureBodyPrefix(doc: Text, figure: Figure): string {
  const image = doc.lineAt(figure.image.from);
  return doc.sliceString(image.from, figure.image.from);
}

export function reindentFigureLine(text: string, oldBase: number, prefix: string): string | undefined {
  if (!text) return text;
  const whitespace = leadingWhitespace(text);
  const relative = columns(whitespace) - oldBase;
  const target = columns(prefix) + relative;
  if (relative < 0) {
    if (!text.trim()) return target > 0 ? " ".repeat(target) : "";
    if (target < 0) return;
    return " ".repeat(target) + text.slice(whitespace.length);
  }
  const body = removeIndent(text, oldBase);
  return columns(prefix + leadingWhitespace(body)) === target ?
    prefix + body : prefix + " ".repeat(relative) + text.slice(whitespace.length);
}
