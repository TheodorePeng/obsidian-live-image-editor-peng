import { Text } from "@codemirror/state";
import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext, type MarkdownSectionInformation } from "obsidian";
import { captionIndex, type CaptionSource, type ImageSource } from "./caption-source";
import { captionClass, clearFigureSize, refreshMath, setFigureSize } from "./figure-layout";
import { sameImage } from "./reading-layout";

const nativeBlock = `${captionClass}--native-reading`;
const tightBlock = `${captionClass}--native-tight`;
const imageFlow = `${captionClass}__reading-image`;
const bodyKinds: Record<string, string> = {
  Paragraph: "p", BulletList: "ul", OrderedList: "ol", Math: ".math-block",
  FencedCode: "pre, [class^=block-language-]", CodeBlock: "pre", Blockquote: "blockquote, .callout",
  HTMLBlock: "div, table, details", Table: "table", HorizontalRule: "hr",
  ATXHeading1: "h1", ATXHeading2: "h2", ATXHeading3: "h3", ATXHeading4: "h4", ATXHeading5: "h5", ATXHeading6: "h6",
  SetextHeading1: "h1", SetextHeading2: "h2"
};

interface Figure {
  picture: HTMLImageElement;
  owner: HTMLElement;
  flow: HTMLElement;
  blocks: readonly HTMLElement[];
}

function directChild(owner: HTMLElement, node: HTMLElement): HTMLElement | undefined {
  while (node.parentElement && node.parentElement !== owner) node = node.parentElement;
  if (node.parentElement === owner) return node;
}

function controls(node: HTMLElement): boolean {
  return node.matches(".list-bullet, .collapse-indicator, .snw-embed-preview, .embed-actions");
}

function matchesBlock(element: HTMLElement, block: string): boolean {
  const selector = bodyKinds[block];
  return !!selector && (element.matches(selector) ||
    (element.childElementCount === 1 && !!element.firstElementChild?.matches(selector)));
}

function findPicture(app: App, owner: HTMLElement, source: ImageSource, path: string, images: Iterable<ImageSource>): HTMLImageElement | undefined {
  const available = [...owner.querySelectorAll<HTMLImageElement>("img[src]")].filter(image =>
    !image.closest(".markdown-embed, button, [role=button]") &&
    (!source.ownerLine || image.closest("li") === owner) && sameImage(app, image, source, path));
  if (!source.ownerLine) return available.length === 1 ? available[0] : undefined;
  const occurrences = [...images].filter(image => image.container === source.container && image.target === source.target);
  if (available.length === occurrences.length) return available[occurrences.indexOf(source)];
}

function tightParagraph(owner: HTMLElement, image: HTMLElement, caption: CaptionSource): HTMLElement | undefined {
  let next = image.nextElementSibling;
  while (next?.instanceOf(HTMLElement) && controls(next)) next = next.nextElementSibling;
  if (next?.instanceOf(HTMLElement) && next.hasClass(tightBlock)) return next;
  if (!caption.terminal || caption.blocks?.length !== 1 || caption.blocks[0] !== "Paragraph") return;
  const children = [];
  for (let node = image.nextSibling; node; node = node.nextSibling) {
    if (node.instanceOf(HTMLElement) && controls(node)) continue;
    if (node.instanceOf(HTMLElement) &&
        !node.matches("span, strong, em, s, del, mark, code, a, br, mjx-container, sup, sub") &&
        !(node.hasClass("snw-link-preview") && node.previousElementSibling?.matches("a.internal-link"))) return;
    if (node.instanceOf(HTMLElement) && node.querySelector("img, .internal-embed")) return;
    children.push(node);
  }
  if (!children.some(node => node.textContent?.trim())) return;
  const wrapper = owner.doc.createElement("div");
  wrapper.addClass(tightBlock);
  const first = children.find(node => node.textContent?.trim());
  first?.parentNode?.insertBefore(wrapper, first);
  wrapper.append(...children);
  return wrapper;
}

class NativeReadingView {
  private stopped = false;
  private readonly contexts = new Map<HTMLElement, MarkdownPostProcessorContext>();
  private readonly resize?: ResizeObserver;
  private readonly contentChanges?: MutationObserver;
  private frame?: number;
  private doc?: Text;
  private markdown?: string;
  private figures: Figure[] = [];
  private blocks = new Set<HTMLElement>();
  private flows = new Set<HTMLElement>();
  private pictures = new Set<HTMLImageElement>();

  constructor(private readonly app: App, private readonly root: HTMLElement) {
    const win = root.doc.defaultView;
    if (win) {
      this.resize = new win.ResizeObserver(this.measure);
      this.resize.observe(root);
      // Some postprocessors expand embeds or add link controls after the section was mounted.
      this.contentChanges = new win.MutationObserver(this.schedule);
      this.contentChanges.observe(root, { childList: true, subtree: true });
    }
    root.addEventListener("load", this.schedule, true);
  }

  add(section: HTMLElement, context: MarkdownPostProcessorContext): () => void {
    this.contexts.set(section, context);
    this.schedule();
    return () => {
      if (this.contexts.get(section) !== context) return;
      this.contexts.delete(section);
      this.schedule();
    };
  }

  get empty(): boolean {
    return !this.contexts.size;
  }

  private readonly schedule = (): void => {
    if (this.stopped || this.frame !== undefined) return;
    this.frame = this.root.win.requestAnimationFrame(() => {
      this.frame = undefined;
      this.refresh();
    });
  };

  private refresh(): void {
    if (!this.root.isConnected) return;
    const sectionInfos = new Map<HTMLElement, MarkdownSectionInformation>();
    let context: MarkdownPostProcessorContext | undefined;
    for (const section of this.root.children) {
      if (!section.instanceOf(HTMLElement) || section.matches(".mod-ui, .markdown-preview-pusher")) continue;
      const candidate = this.contexts.get(section) ?? context ?? this.contexts.values().next().value;
      const info = candidate?.getSectionInfo(section);
      if (!info) continue;
      sectionInfos.set(section, info);
      context = candidate;
    }
    const first = sectionInfos.values().next().value;
    if (!first || !context) return;
    if (this.markdown !== first.text) {
      this.markdown = first.text;
      this.doc = Text.of(first.text.split(/\r?\n/));
    }
    if (!this.doc) return;
    const index = captionIndex(this.doc);
    const figures = [];
    for (const caption of index.captionedImages.values()) {
      const image = caption.image;
      if (caption.format !== "comment" || !caption.closed || !caption.body || !image) continue;
      const section = [...sectionInfos].find(([, info]) => info.text === first.text &&
        image.line > info.lineStart && image.line <= info.lineEnd + 1);
      if (!section) continue;
      const [element, info] = section;
      if (!image.ownerLine) {
        const picture = findPicture(this.app, element, image, context.sourcePath, index.images.values());
        if (!picture || info.lineEnd + 1 !== image.line) continue;
        const endLoaded = [...sectionInfos.values()].some(piece => piece.text === info.text && piece.lineEnd + 1 === caption.endLine);
        if (!endLoaded) continue;
        const blocks = [...sectionInfos].filter(([, piece]) => piece.text === info.text &&
          piece.lineStart + 1 > caption.openLine && piece.lineEnd + 1 < caption.endLine)
          .flatMap(([block]) => block.firstElementChild?.instanceOf(HTMLElement) ? [block.firstElementChild] : []);
        if (!blocks.length) continue;
        figures.push({ picture, owner: element, flow: picture.closest("p") ?? element, blocks });
        continue;
      }
      if (caption.endLine > info.lineEnd + 1) continue;
      const owner = element.querySelector<HTMLElement>(`li[data-line="${image.ownerLine - info.lineStart - 1}"]`);
      if (!owner || owner.closest(".markdown-embed")) continue;
      const picture = findPicture(this.app, owner, image, context.sourcePath, index.images.values());
      const anchor = picture && directChild(owner, picture);
      if (!picture || !anchor) continue;
      const found = [];
      let sibling = anchor.nextElementSibling;
      for (const kind of caption.blocks ?? []) {
        while (sibling?.instanceOf(HTMLElement) && controls(sibling)) sibling = sibling.nextElementSibling;
        if (!sibling?.instanceOf(HTMLElement) || !matchesBlock(sibling, kind)) break;
        found.push(sibling);
        sibling = sibling.nextElementSibling;
      }
      const tight = !found.length && anchor.matches("span, img") ? tightParagraph(owner, anchor, caption) : undefined;
      const blocks = tight ? [tight] : found;
      if (!blocks.length || blocks.length !== caption.blocks?.length) continue;
      figures.push({ picture, owner, flow: anchor, blocks });
    }
    const nextBlocks = new Set(figures.flatMap(figure => figure.blocks));
    for (const previous of this.figures) {
      for (const block of previous.blocks) {
        if (block.hasClass(tightBlock) && !nextBlocks.has(block)) this.clearBlock(block);
      }
    }
    this.figures = figures;
    const nextPictures = new Set(figures.map(figure => figure.picture));
    for (const image of this.pictures) if (!nextPictures.has(image)) this.resize?.unobserve(image);
    for (const image of nextPictures) if (!this.pictures.has(image)) this.resize?.observe(image);
    this.pictures = nextPictures;
    this.measure();
  }

  private readonly measure = (): void => {
    const nextBlocks = new Set<HTMLElement>();
    const nextFlows = new Set<HTMLElement>();
    for (const { picture, owner, flow, blocks } of this.figures) {
      const rect = picture.getBoundingClientRect();
      if (!picture.isConnected || !picture.naturalWidth || !rect.width || !rect.height) continue;
      nextFlows.add(flow);
      flow.addClass(imageFlow);
      for (const block of blocks) {
        if (!block.isConnected) continue;
        nextBlocks.add(block);
        block.addClass(nativeBlock);
        const container = block.parentElement ?? owner;
        const left = container.getBoundingClientRect().left + container.clientLeft;
        setFigureSize(block, rect, Math.max(0, rect.left - left));
        refreshMath(block);
      }
    }
    for (const block of this.blocks) if (!nextBlocks.has(block)) this.clearBlock(block);
    for (const flow of this.flows) if (!nextFlows.has(flow)) flow.removeClass(imageFlow);
    this.blocks = nextBlocks;
    this.flows = nextFlows;
  };

  private clearBlock(block: HTMLElement): void {
    block.removeClass(nativeBlock);
    clearFigureSize(block);
    if (block.hasClass(tightBlock)) block.replaceWith(...block.childNodes);
  }

  destroy(): void {
    this.stopped = true;
    if (this.frame !== undefined) this.root.win.cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.contentChanges?.disconnect();
    this.root.removeEventListener("load", this.schedule, true);
    for (const block of new Set([...this.blocks, ...this.figures.flatMap(figure => figure.blocks)])) this.clearBlock(block);
    for (const flow of this.flows) flow.removeClass(imageFlow);
    this.figures = [];
    this.contexts.clear();
  }
}

export class NativeCaptionReading {
  private readonly views = new Map<HTMLElement, NativeReadingView>();
  private stopped = false;

  constructor(private readonly app: App) {}

  connect(section: HTMLElement, context: MarkdownPostProcessorContext): (() => void) | undefined {
    const root = section.parentElement;
    if (this.stopped || !root?.matches(".markdown-preview-section") || section.closest(".markdown-embed") ||
        !context.getSectionInfo(section)?.text.includes("<!-- image-caption:start -->")) return;
    let view = this.views.get(root);
    if (!view) {
      view = new NativeReadingView(this.app, root);
      this.views.set(root, view);
    }
    const remove = view.add(section, context);
    return () => {
      remove();
      if (view.empty && this.views.get(root) === view) {
        view.destroy();
        this.views.delete(root);
      }
    };
  }

  destroy(): void {
    this.stopped = true;
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
  }
}

export class NativeCaptionReadingSection extends MarkdownRenderChild {
  private connected = false;

  constructor(el: HTMLElement, private readonly reading: NativeCaptionReading, private readonly context: MarkdownPostProcessorContext) {
    super(el);
  }

  onload(): void {
    this.register(this.containerEl.onNodeInserted(() => this.connect(), true));
    this.connect();
  }

  private connect(): void {
    if (this.connected) return;
    const disconnect = this.reading.connect(this.containerEl, this.context);
    if (!disconnect) return;
    this.connected = true;
    this.register(disconnect);
  }
}
