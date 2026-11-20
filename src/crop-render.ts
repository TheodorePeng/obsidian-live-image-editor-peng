import { Text } from "@codemirror/state";
import { BlockType, type EditorView } from "@codemirror/view";
import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext } from "obsidian";
import { cropInset, cropWidthForHeight, type Crop } from "./crop-state";
import { imageReferences, type ImageReference } from "./image-source";
import { isLocalImageTarget, sameImage } from "./image-target";

const croppedClass = "live-image-editor-peng--cropped";
const resizeCommitClass = "live-image-editor-peng--resize-commit";
const insetProperty = "--live-image-editor-crop-inset";
const heightWidthProperty = "--live-image-editor-crop-height-width";
const liveHost = ".cm-line, .cm-embed-block";
const excluded = ".markdown-embed, button, [role=button]";

export function supportsCrop(image: HTMLImageElement): boolean {
  return (image.ownerDocument.defaultView?.CSS ?? CSS).supports("object-view-box", "inset(1%)");
}

function applyCrop(image: HTMLImageElement, crop: Crop): void {
  const inset = cropInset(crop);
  const heightWidth = cropWidthForHeight(crop, image.naturalWidth, image.naturalHeight, image.getAttribute("height"));
  const heightWidthValue = heightWidth === undefined ? "" : `${heightWidth}px`;
  if (image.style.getPropertyValue(insetProperty) !== inset) image.style.setProperty(insetProperty, inset);
  if (image.style.getPropertyValue(heightWidthProperty) !== heightWidthValue) {
    image.style.setProperty(heightWidthProperty, heightWidthValue);
  }
  if (!image.hasClass(croppedClass)) image.addClass(croppedClass);
}

export class CropDisplay {
  private readonly images = new Set<HTMLImageElement>();

  update(pairs: ReadonlyMap<HTMLImageElement, ImageReference>): void {
    for (const image of this.images) {
      const source = pairs.get(image);
      if (!source?.marker?.crop || !isLocalImageTarget(source.target)) {
        image.removeClass(croppedClass, resizeCommitClass);
        image.style.removeProperty(insetProperty);
        image.style.removeProperty(heightWidthProperty);
        this.images.delete(image);
      }
    }
    for (const [image, reference] of pairs) {
      const crop = reference.marker?.crop;
      if (crop && isLocalImageTarget(reference.target) && image.naturalWidth && image.naturalHeight && supportsCrop(image)) {
        applyCrop(image, crop);
        this.images.add(image);
      }
    }
  }

  preserveWidthForResizeCommit(): void {
    for (const image of this.images) {
      if (!image.hasAttribute("height") || !image.closest(".is-resizing")) continue;
      // Obsidian clears its drag state before reading clientWidth on pointerup.
      image.addClass(resizeCommitClass);
      image.win.requestAnimationFrame(() => image.removeClass(resizeCommitClass));
    }
  }

  clear(): void {
    this.update(new Map());
  }
}

function nativeImages(host: HTMLElement): HTMLImageElement[] {
  return [...host.querySelectorAll<HTMLImageElement>("img[src]")].filter(image =>
    !image.closest(excluded) && (!host.matches(liveHost) || image.closest(liveHost) === host));
}

function pairImages(app: App, path: string, host: HTMLElement, sources: readonly ImageReference[],
  pairs: Map<HTMLImageElement, ImageReference>): void {
  if (!sources.length) return;
  const images = nativeImages(host);
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

export function liveImagePairs(app: App, path: string, view: EditorView): Map<HTMLImageElement, ImageReference> {
  const { references, lines } = imageReferences(view.state.doc);
  const pairs = new Map<HTMLImageElement, ImageReference>();
  if (!references.length) return pairs;
  const hosts = new Set<HTMLElement>();
  for (const img of nativeImages(view.contentDOM)) {
    const host = img.closest<HTMLElement>(liveHost);
    if (host && view.contentDOM.contains(host)) hosts.add(host);
  }
  for (const host of hosts) {
    const range = hostRange(view, host);
    if (!range) continue;
    const sources = host.matches(".cm-line") ? lines.get(view.state.doc.lineAt(range.from).number) ?? [] :
      references.filter(source => source.from >= range.from && source.to <= range.to);
    pairImages(app, path, host, sources, pairs);
  }
  return pairs;
}

const snapshots = new WeakMap<HTMLElement, { source: string; doc: Text }>();

export class CropReadingSection extends MarkdownRenderChild {
  private readonly display = new CropDisplay();
  private frame?: number;
  private listening = false;
  private stopped = false;

  constructor(section: HTMLElement, private readonly app: App, private readonly context: MarkdownPostProcessorContext) {
    super(section);
  }

  onload(): void {
    if (this.stopped) return;
    if (this.containerEl.isConnected) this.mount();
    else this.register(this.containerEl.onNodeInserted(() => this.mount(), true));
  }

  stop(): void {
    this.stopped = true;
    this.unload();
  }

  private mount(): void {
    const section = this.containerEl;
    const root = section.closest<HTMLElement>(".markdown-preview-section");
    if (this.stopped || this.listening || !root || section.closest(".cm-editor, .markdown-embed")) return;
    const win = section.win;
    this.listening = true;
    section.addEventListener("load", this.schedule, true);
    const observer = new MutationObserver(this.schedule);
    observer.observe(section, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "width", "height"] });
    this.register(() => {
      observer.disconnect();
      section.removeEventListener("load", this.schedule, true);
      if (this.frame !== undefined) win.cancelAnimationFrame(this.frame);
      this.display.clear();
    });
    this.schedule();
  }

  private readonly schedule = (): void => {
    if (this.frame !== undefined) return;
    this.frame = this.containerEl.win.requestAnimationFrame(() => {
      this.frame = undefined;
      this.refresh();
    });
  };

  private refresh(): void {
    const section = this.containerEl;
    const root = section.closest<HTMLElement>(".markdown-preview-section");
    const info = this.context.getSectionInfo(section);
    const pairs = new Map<HTMLImageElement, ImageReference>();
    if (root && info?.text.includes("<!-- live-image-editor-peng:v")) {
      let snapshot = snapshots.get(root);
      if (snapshot?.source !== info.text) {
        snapshot = { source: info.text, doc: Text.of(info.text.split(/\r?\n/)) };
        snapshots.set(root, snapshot);
      }
      const { doc } = snapshot;
      if (info.lineStart < 0 || info.lineStart >= doc.lines || info.lineEnd < info.lineStart) {
        this.display.clear();
        return;
      }
      const from = doc.line(info.lineStart + 1).from;
      const to = doc.line(Math.min(info.lineEnd + 1, doc.lines)).to;
      const sources = imageReferences(doc).references.filter(image => image.from >= from && image.to <= to);
      if (sources.some(source => source.marker?.crop)) pairImages(this.app, this.context.sourcePath, section, sources, pairs);
    }
    this.display.update(pairs);
  }
}
