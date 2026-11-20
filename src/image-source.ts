import type { Text } from "@codemirror/state";
import { parseDocument } from "./markdown-source";

export interface ImageReference {
  from: number;
  to: number;
  target: string;
}

interface ImageIndex {
  references: ImageReference[];
  lines: Map<number, ImageReference[]>;
}

const cache = new WeakMap<Text, ImageIndex>();
const imageExtension = /\.(?:avif|bmp|gif|heic|ico|jpe?g|png|svg|tiff?|webp)$/i;

export function imageReferences(doc: Text): ImageIndex {
  const cached = cache.get(doc);
  if (cached) return cached;

  const references: ImageReference[] = [];
  const lines = new Map<number, ImageReference[]>();
  parseDocument(doc).iterate({
    enter({ name, node, from, to }) {
      if (name !== "Image") return;
      const raw = doc.sliceString(from, to);
      const wiki = /^!\[\[([^[\]\n]+)\]\]$/.exec(raw)?.[1];
      const path = wiki?.split(/\\?\||#/, 1)[0]?.trim();
      const url = node.getChild("URL");
      const target = path && imageExtension.test(path) ? path : url && node.getChildren("LinkMark")
        .some(mark => doc.sliceString(mark.from, mark.to) === "(")
        ? doc.sliceString(url.from, url.to).replace(/^<|>$/g, "") : undefined;
      if (!target || doc.lineAt(from).number !== doc.lineAt(to).number) return false;

      const reference = { from, to, target };
      references.push(reference);
      const line = doc.lineAt(from).number;
      const existing = lines.get(line);
      if (existing) existing.push(reference);
      else lines.set(line, [reference]);
      return false;
    }
  });

  const index = { references, lines };
  cache.set(doc, index);
  return index;
}
