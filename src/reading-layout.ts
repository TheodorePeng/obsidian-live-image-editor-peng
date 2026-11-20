import { Text } from "@codemirror/state";
import { type App, type MarkdownPostProcessorContext } from "obsidian";
import { captionIndex, type ImageSource } from "./caption-source";
import { captionClass, clearFigureSize, refreshMath, setFigureSize } from "./figure-layout";

const joinedImage = `${captionClass}__reading-image`;
const joinedMedia = `${captionClass}__reading-media`;
const joinedFrame = `${captionClass}__reading-frame`;
const previewDocuments = new WeakMap<HTMLElement, { markdown: string; doc: Text }>();

function resolveTarget(app: App, target: string, sourcePath: string): string | undefined {
  if (/^(https?:|data:)/i.test(target)) return target;
  const file = app.metadataCache.getFirstLinkpathDest(decodeLink(target), sourcePath);
  if (file) return app.vault.getResourcePath(file);
}

function decodeLink(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function sameImage(app: App, image: HTMLImageElement, source: ImageSource, path: string): boolean {
  const expected = resolveTarget(app, source.target, path);
  if (!expected || !URL.canParse(expected) || !URL.canParse(image.src)) return false;
  const lhs = new URL(expected);
  const rhs = new URL(image.src);
  if (lhs.protocol === "app:" && rhs.protocol === "app:") {
    return lhs.host === rhs.host && decodeLink(lhs.pathname) === decodeLink(rhs.pathname);
  }
  return lhs.href === rhs.href;
}

function renderedImageBefore(frame: HTMLElement, root: HTMLElement): { image: HTMLImageElement; flow: HTMLElement } | undefined {
  const container = frame.parentElement;
  if (container !== root && container?.tagName !== "LI") return;
  let sibling = frame.previousSibling;
  // Strange New Worlds can insert its embed reference badge after an image in a tight list.
  while (sibling && ((sibling.nodeType === 3 && !sibling.textContent?.trim()) ||
    (sibling.instanceOf(HTMLElement) && sibling.matches(".snw-embed-preview")))) {
    sibling = sibling.previousSibling;
  }
  if (!sibling?.instanceOf(HTMLElement) || !sibling.matches(".el-p, p, span, img")) return;
  const image = sibling.instanceOf(HTMLImageElement) ? sibling :
    [...sibling.querySelectorAll<HTMLImageElement>("img[src]")]
      .filter(candidate => !candidate.closest(".markdown-embed, button, [role=button]")).at(-1);
  if (!image) return;
  return { image, flow: image.closest("p") ?? sibling };
}

function findPair(app: App, element: HTMLElement, source: string, context: MarkdownPostProcessorContext) {
  const root = element.closest<HTMLElement>(".markdown-preview-section");
  if (!root || element.parentElement?.closest(`.${captionClass}, .markdown-embed`)) return;
  const frame = element.parentElement?.matches(".el-pre") ? element.parentElement : element;
  let section = frame;
  while (section.parentElement && section.parentElement !== root) section = section.parentElement;
  if (section.parentElement !== root) return;
  const info = context.getSectionInfo(section);
  if (!info) return;
  let snapshot = previewDocuments.get(root);
  if (snapshot?.markdown !== info.text) {
    snapshot = { markdown: info.text, doc: Text.of(info.text.split(/\r?\n/)) };
    previewDocuments.set(root, snapshot);
  }
  const captions = [...captionIndex(snapshot.doc).captions.values()]
    .filter(caption => caption.closed && caption.openLine >= info.lineStart + 1 && caption.openLine <= info.lineEnd + 1);
  const widgets = [...section.querySelectorAll<HTMLElement>(`.${captionClass}`)].filter(widget =>
    !widget.parentElement?.closest(`.${captionClass}, .markdown-embed`));
  if (captions.length !== widgets.length) return;
  const caption = captions[widgets.indexOf(element)];
  if (!caption?.image || caption.body.trimEnd() !== source.trimEnd()) return;
  const pair = renderedImageBefore(frame, root);
  if (!pair || !sameImage(app, pair.image, caption.image, context.sourcePath)) return;
  return { ...pair, frame };
}

export class ReadingFigure {
  private pair?: ReturnType<typeof findPair>;
  private observer?: ResizeObserver;
  private pending?: number;

  constructor(private readonly element: HTMLElement) {}

  mount(app: App, source: string, context: MarkdownPostProcessorContext): void {
    const pair = findPair(app, this.element, source, context);
    if (!pair) return;
    this.pair = pair;
    const win = this.element.doc.defaultView;
    if (!win) return;
    this.observer = new win.ResizeObserver(this.schedule);
    this.observer.observe(pair.image);
    if (pair.frame.parentElement) this.observer.observe(pair.frame.parentElement);
    pair.image.addEventListener("load", this.schedule);
    pair.image.addEventListener("error", this.schedule);
    this.measure();
  }

  readonly schedule = (): void => {
    if (this.pending !== undefined) return;
    this.pending = this.element.doc.defaultView?.requestAnimationFrame(() => {
      this.pending = undefined;
      this.measure();
    });
  };

  destroy(): void {
    if (this.pending !== undefined) this.element.doc.defaultView?.cancelAnimationFrame(this.pending);
    this.observer?.disconnect();
    this.pair?.image.removeEventListener("load", this.schedule);
    this.pair?.image.removeEventListener("error", this.schedule);
    this.clear();
  }

  private clear(): void {
    this.pair?.flow.removeClass(joinedImage);
    this.pair?.image.removeClass(joinedMedia);
    this.pair?.frame.removeClass(joinedFrame);
    clearFigureSize(this.element);
  }

  private measure(): void {
    const pair = this.pair;
    if (!pair || !this.element.isConnected) return;
    const { image, flow, frame } = pair;
    const rectangle = image.getBoundingClientRect();
    if (!image.isConnected || !image.naturalWidth || !rectangle.width || !rectangle.height) {
      this.clear();
      return;
    }
    if (!image.hasClass(joinedMedia)) image.addClass(joinedMedia);
    if (!flow.hasClass(joinedImage)) flow.addClass(joinedImage);
    if (!frame.hasClass(joinedFrame)) frame.addClass(joinedFrame);
    // For nested list items the caption element is its own frame.
    const left = frame === this.element ? frame.parentElement?.getBoundingClientRect().left : frame.getBoundingClientRect().left;
    if (left === undefined) return;
    setFigureSize(this.element, rectangle, rectangle.left - left);
    refreshMath(this.element);
  }
}
