import { BlockType, type EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { imageReferences, type ImageReference } from "./image-source";
import { sameImage } from "./image-target";
import { ownsMarkdownElement, type MarkdownRenderScope } from "./markdown-render-scope";

const liveHost = ".cm-line, .cm-embed-block";
const controls = "button, [role=button]";

function nativeImages(host: HTMLElement, scope?: MarkdownRenderScope): HTMLImageElement[] {
  return [...host.querySelectorAll<HTMLImageElement>("img[src]")].filter(image =>
    !image.closest(controls) && (scope ? ownsMarkdownElement(scope, image) : !image.closest(".markdown-embed")) &&
    (!host.matches(liveHost) || image.closest(liveHost) === host));
}

export function pairImages(app: App, path: string, host: HTMLElement, sources: readonly ImageReference[],
  pairs: Map<HTMLImageElement, ImageReference>, scope?: MarkdownRenderScope): void {
  if (!sources.length) return;
  const images = nativeImages(host, scope);
  if (images.length !== sources.length ||
      !images.every((image, index) => sameImage(app, image, sources[index], path))) return;
  images.forEach((image, index) => pairs.set(image, sources[index]));
}

function hostRange(view: EditorView, host: HTMLElement): { from: number; to: number } | undefined {
  try {
    const from = view.posAtDOM(host, 0);
    if (host.matches(".cm-line")) return view.state.doc.lineAt(from);
    const to = view.posAtDOM(host, host.childNodes.length);
    if (to > from) return { from, to };
    const block = view.lineBlockAt(from);
    if (block.type === BlockType.WidgetRange && block.from === from && block.to > from) {
      return { from, to: block.to };
    }
  } catch {
    // DOM from an editor update may already have been detached.
  }
}

export function liveImageReference(app: App, path: string, view: EditorView, image: HTMLImageElement): ImageReference | undefined {
  const host = image.closest<HTMLElement>(liveHost);
  if (!host || !view.contentDOM.contains(host)) return;
  const range = hostRange(view, host);
  if (!range) return;
  const { references, lines } = imageReferences(view.state.doc);
  const sources = host.matches(".cm-line") ? lines.get(view.state.doc.lineAt(range.from).number) ?? [] :
    references.filter(source => source.from >= range.from && source.to <= range.to);
  const pairs = new Map<HTMLImageElement, ImageReference>();
  pairImages(app, path, host, sources, pairs);
  return pairs.get(image);
}

