import { Text } from "@codemirror/state";
import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext, type MarkdownSectionInformation } from "obsidian";
import { displayCrop } from "./figure-display";
import { captionClass, clearFigureSize, figureContentLeft, refreshMath, setFigureSize } from "./figure-layout";
import { figureIndex, type Figure } from "./figure-source";
import { imageReferences, type ImageReference } from "./image-source";
import { isLocalImageTarget } from "./image-target";
import { markdownRenderScope, ownsMarkdownElement, type MarkdownRenderScope } from "./markdown-render-scope";
import { parseDocument } from "./markdown-source";
import { pairImages } from "./native-images";

const nativeCaption = `${captionClass}--native-reading`;
const imageFlow = `${captionClass}__reading-image`;
const selectors: Record<string, string> = {
  Paragraph: "p, .math-block, mjx-container",
  BulletList: "ul", OrderedList: "ol", Blockquote: "blockquote, .callout", FencedCode: "pre, .block-language-mermaid",
  CodeBlock: "pre", Table: "table", ATXHeading1: "h1", ATXHeading2: "h2", ATXHeading3: "h3",
  ATXHeading4: "h4", ATXHeading5: "h5", ATXHeading6: "h6", SetextHeading1: "h1", SetextHeading2: "h2",
  HorizontalRule: "hr"
};

function captionKinds(caption: string): string[] {
  const result: string[] = [];
  const doc = Text.of(caption.split("\n"));
  for (let node = parseDocument(doc).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "CommentBlock") result.push(node.name);
  }
  return result;
}

function matchingBlock(el: HTMLElement, kind: string): boolean {
  const selector = selectors[kind];
  return !!selector && (el.matches(selector) || el.childElementCount === 1 && !!el.firstElementChild?.matches(selector));
}

function anchorIn(parent: HTMLElement, image: HTMLImageElement): HTMLElement | undefined {
  for (let el: HTMLElement | null = image; el; el = el.parentElement) {
    if (el.parentElement === parent) return el;
  }
}

interface FigureProjection {
  figure: Figure;
  image: HTMLImageElement;
  blocks: HTMLElement[];
  flow?: HTMLElement;
}

function captionBlocks(figure: Figure, doc: Text, image: HTMLImageElement,
  sections: ReadonlyMap<HTMLElement, MarkdownSectionInformation>, scope: MarkdownRenderScope): HTMLElement[] {
  if (!figure.caption) return [];
  const kinds = captionKinds(figure.caption);
  const body: HTMLElement[] = [];
  if (figure.owner.name === "ListItem") {
    const item = image.closest<HTMLElement>("li");
    if (!item || !ownsMarkdownElement(scope, item)) return [];
    let sibling = anchorIn(item, image)?.nextElementSibling ?? null;
    for (const kind of kinds) {
      while (sibling?.matches(".list-bullet, .collapse-indicator, .embed-actions, .snw-embed-preview, [hidden]")) {
        sibling = sibling.nextElementSibling;
      }
      if (!sibling?.instanceOf(HTMLElement) || !matchingBlock(sibling, kind)) return [];
      body.push(sibling);
      sibling = sibling.nextElementSibling;
    }
  } else {
    const imageLine = doc.lineAt(figure.image.from).number;
    const closeLine = doc.lineAt(figure.closing.from).number;
    // A Canvas subpath can show just the original image paragraph.
    if (![...sections.values()].some(info => info.lineStart + 1 <= closeLine && info.lineEnd + 1 >= closeLine)) return [];
    for (const [section, info] of sections) {
      if (info.lineStart + 1 > imageLine && info.lineEnd + 1 < closeLine && section.firstElementChild?.instanceOf(HTMLElement)) {
        body.push(section.firstElementChild);
      }
    }
  }
  return body.length === kinds.length && body.every((element, index) => matchingBlock(element, kinds[index])) ? body : [];
}

class ReadingRoot {
  readonly contexts = new Map<HTMLElement, MarkdownPostProcessorContext>();
  private readonly mutation: MutationObserver;
  private readonly resize: ResizeObserver;
  private readonly root: HTMLElement;
  private frame?: number;
  private destroyed = false;
  private source?: string;
  private doc?: Text;
  private projected: FigureProjection[] = [];
  private readonly styled = new Set<HTMLElement>();

  constructor(private readonly app: App, private readonly scope: MarkdownRenderScope) {
    const { root } = scope;
    this.root = root;
    const win = root.doc.defaultView ?? window;
    this.mutation = new win.MutationObserver(this.schedule);
    this.mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "width", "height"] });
    this.resize = new win.ResizeObserver(this.measure);
    this.resize.observe(root);
    root.addEventListener("load", this.schedule, true);
  }

  readonly schedule = (): void => {
    if (this.destroyed) return;
    this.frame ??= this.root.win.requestAnimationFrame(() => {
      this.frame = undefined;
      this.refresh();
    });
  };

  private refresh(): void {
    if (!this.root.isConnected) return;
    const owner = this.scope;
    const context = [...this.contexts.values()].at(-1);
    const sections = new Map<HTMLElement, MarkdownSectionInformation>();
    for (const section of this.root.children) {
      if (!section.instanceOf(HTMLElement) || !ownsMarkdownElement(owner, section)) continue;
      const current = this.contexts.get(section) ?? context;
      if (!current || current.docId !== context?.docId || current.sourcePath !== context.sourcePath) continue;
      const info = current.getSectionInfo(section);
      if (info) sections.set(section, info);
    }
    const source = [...sections.values()].at(-1)?.text;
    if (source !== this.source) {
      this.source = source;
      this.doc = source?.includes("<!-- live-image-figure:v1") ? Text.of(source.split(/\r?\n/)) : undefined;
    }
    const doc = this.doc;
    const projections: FigureProjection[] = [];
    if (doc && context) {
      for (const [section, info] of [...sections]) if (info.text !== source) sections.delete(section);
      const references = imageReferences(doc).references;
      const figures = figureIndex(doc).figures;
      const sourceFigures = new Map(figures.map(figure => [figure.image.from, figure]));
      const pairs = new Map<HTMLImageElement, ImageReference>();
      for (const [section, info] of sections) {
        if (info.lineStart < 0 || info.lineStart >= doc.lines || info.lineEnd < info.lineStart) continue;
        const a = doc.line(info.lineStart + 1).from;
        const b = doc.line(Math.min(info.lineEnd + 1, doc.lines)).to;
        const sources = references.filter(ref => ref.from >= a && ref.to <= b);
        if (sources.some(ref => sourceFigures.has(ref.from))) pairImages(this.app, context.sourcePath, section, sources, pairs, owner);
      }
      for (const [image, ref] of pairs) {
        const figure = sourceFigures.get(ref.from);
        if (!figure) continue;
        const blocks = captionBlocks(figure, doc, image, sections, owner);
        projections.push({ figure, image, blocks, flow: blocks.length ? image.closest("p") ?? undefined : undefined });
      }
    }

    const nextImages = new Set(projections.map(projection => projection.image));
    const previousImages = new Set(this.projected.map(projection => projection.image));
    const flows = new Set(projections.map(projection => projection.flow));
    for (const previous of this.projected) {
      if (!nextImages.has(previous.image)) {
        this.resize.unobserve(previous.image);
        displayCrop(previous.image);
      }
      if (!flows.has(previous.flow)) previous.flow?.removeClass(imageFlow);
    }
    for (const projection of projections) {
      if (!previousImages.has(projection.image)) this.resize.observe(projection.image);
      if (isLocalImageTarget(projection.figure.image.target)) displayCrop(projection.image, projection.figure.crop);
      projection.flow?.addClass(imageFlow);
    }
    this.projected = projections;
    this.measure();
  }

  private readonly measure = (): void => {
    const active = new Set<HTMLElement>();
    const scale = this.scope.canvasCard && this.root.offsetWidth ? this.root.getBoundingClientRect().width / this.root.offsetWidth || 1 : 1;
    for (const { image, blocks } of this.projected) {
      const picture = image.getBoundingClientRect();
      if (!image.isConnected || !picture.width || !picture.height) continue;
      for (const block of blocks) {
        if (!block.isConnected || !block.parentElement) continue;
        const offset = picture.left - figureContentLeft(block.parentElement, scale);
        block.addClass(nativeCaption);
        setFigureSize(block, picture, Math.max(offset, 0), scale);
        refreshMath(block, scale);
        active.add(block);
      }
    }
    for (const block of this.styled) if (!active.has(block)) this.clearBlock(block);
    this.styled.clear();
    for (const block of active) this.styled.add(block);
  };

  private clearBlock(block: HTMLElement): void {
    block.removeClass(nativeCaption);
    clearFigureSize(block);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.contexts.clear();
    if (this.frame !== undefined) this.root.win.cancelAnimationFrame(this.frame);
    this.root.removeEventListener("load", this.schedule, true);
    this.mutation.disconnect();
    this.resize.disconnect();
    for (const { image, flow } of this.projected) {
      displayCrop(image);
      flow?.removeClass(imageFlow);
    }
    for (const block of this.styled) this.clearBlock(block);
    this.styled.clear();
  }
}

export class FigureReading {
  private readonly roots = new Map<HTMLElement, ReadingRoot>();
  private stopped = false;

  constructor(private readonly app: App) {}

  child(section: HTMLElement, context: MarkdownPostProcessorContext): MarkdownRenderChild {
    const child = new MarkdownRenderChild(section);
    let connected = false;
    const connect = () => {
      if (connected || this.stopped) return;
      const scope = markdownRenderScope(section);
      if (!scope || section.parentElement !== scope.root ||
          !context.getSectionInfo(section)?.text.includes("<!-- live-image-figure:v1")) return;
      connected = true;
      let root = this.roots.get(scope.root);
      if (!root) {
        root = new ReadingRoot(this.app, scope);
        this.roots.set(scope.root, root);
      }
      root.contexts.set(section, context);
      root.schedule();
      child.register(() => {
        if (root.contexts.get(section) === context) root.contexts.delete(section);
        if (root.contexts.size) root.schedule();
        else if (this.roots.get(scope.root) === root) {
          root.destroy();
          this.roots.delete(scope.root);
        }
      });
    };
    child.onload = () => {
      child.register(section.onNodeInserted(connect, true));
      connect();
    };
    return child;
  }

  destroy(): void {
    this.stopped = true;
    for (const root of this.roots.values()) root.destroy();
    this.roots.clear();
  }
}
