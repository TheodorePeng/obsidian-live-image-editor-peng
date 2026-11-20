import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  Component,
  editorInfoField,
  editorLivePreviewField,
  MarkdownRenderChild,
  MarkdownRenderer,
  Plugin,
  setIcon,
  type EventRef,
  type Workspace,
  type MarkdownPostProcessorContext
} from "obsidian";
import { captionIndex, captionInsertion, captionLanguage, type CaptionSource, type ImageSource } from "./caption-source";

import { compactLinesField, setCompactLines, type CompactLines } from "./compact-lines";

import { captionClass, clearFigureSize, refreshMath, setFigureSize } from "./figure-layout";
import { NativeCaptionReading, NativeCaptionReadingSection } from "./native-caption-reading";
import { NativeCaptionLines, nativeCaptionRows } from "./native-caption-lines";
import { ReadingFigure } from "./reading-layout";
import { imageActionPosition } from "./image-action-placement";
import { captionIndentExtension } from "./indent-extension";
import { CaptionIndentation, type IndentationPair } from "./indentation-guides";

const addLabel = "添加图注";
const leaveDelay = 180;
const emptyLabel = "添加图注内容";
const orphanLabel = "未关联图片";

function livePreview(view: EditorView): boolean {
  return view.state.field(editorLivePreviewField, false) === true;
}

function captionAtElement(view: EditorView, element: HTMLElement): CaptionSource | undefined {
  if (!element.isConnected || element.parentElement?.parentElement !== view.contentDOM) return;
  const offset = view.posAtDOM(element);
  const line = view.state.doc.lineAt(offset);
  const caption = captionIndex(view.state.doc).captions.get(line.number);
  return caption?.closed && caption.format === "fence" ? caption : undefined;
}

function imageAtElement(view: EditorView, element: HTMLImageElement): ImageSource | undefined {
  if (!element.isConnected || !element.naturalWidth || !view.contentDOM.contains(element)) return;
  if (element.closest(`.${captionClass}, .markdown-embed`)) return;
  const lineElement = element.closest(".cm-line");
  if (!lineElement || lineElement.parentElement !== view.contentDOM) return;
  const offset = view.posAtDOM(element);
  const line = view.state.doc.lineAt(offset);
  const image = captionIndex(view.state.doc).images.get(line.number);
  const lineImages = [...lineElement.querySelectorAll<HTMLImageElement>("img[src]")];
  return image && offset >= line.from && offset <= image.to &&
    lineImages.filter(candidate => !candidate.closest(".markdown-embed")).length === 1 ? image : undefined;
}

function containsPoint(rect: DOMRectReadOnly, x: number, y: number): boolean {
  return rect.width > 0 && rect.height > 0 &&
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

class CaptionBlock extends MarkdownRenderChild {
  private status?: HTMLElement;
  private body?: HTMLElement;
  private renderedSource?: string;
  private showingPlaceholder = false;
  private renderedChild?: Component;
  private frame?: number;
  private readingFigure?: ReadingFigure;
  private press?: { x: number; y: number };

  constructor(
    element: HTMLElement,
    private readonly plugin: ImageCaptionPlugin,
    private readonly source: string,
    private readonly context: MarkdownPostProcessorContext
  ) {
    super(element);
  }

  onload(): void {
    const element = this.containerEl;
    element.addClass(captionClass);
    this.status = element.createDiv({ cls: `${captionClass}__status`, attr: { hidden: "" } });
    this.body = element.createDiv({ cls: `${captionClass}__body` });
    this.registerDomEvent(element, "pointerdown", event => {
      this.press = { x: event.clientX, y: event.clientY };
    });
    this.registerDomEvent(element, "click", event => this.edit(event));
    this.scheduleMount();
  }

  private scheduleMount(): void {
    const element = this.containerEl;
    this.frame = element.ownerDocument.defaultView?.requestAnimationFrame(() => {
      this.frame = undefined;
      if (!element.isConnected) {
        this.register(element.onNodeInserted(() => this.scheduleMount(), true));
        return;
      }
      this.refresh();
      if (this.source.trim() && !this.editor() && element.closest(".markdown-preview-section")) {
        this.readingFigure = new ReadingFigure(element);
        this.readingFigure.mount(this.plugin.app, this.source, this.context);
      }
    });
  }

  onunload(): void {
    this.readingFigure?.destroy();
    if (this.frame !== undefined) this.containerEl.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
  }

  private editor(): EditorView | undefined {
    const root = this.containerEl.closest<HTMLElement>(".cm-editor");
    const view = root && EditorView.findFromDOM(root);
    if (!view || !livePreview(view) || !view.contentDOM.contains(this.containerEl)) return;
    return view.state.field(editorInfoField, false)?.file?.path === this.context.sourcePath ? view : undefined;
  }

  refresh(): void {
    if (!this.status || !this.body || !this.containerEl.isConnected) return;
    if (this.containerEl.parentElement?.closest(`.${captionClass}`)) {
      if (this.renderedSource === undefined) {
        this.renderedSource = this.source;
        this.body.createEl("pre").createEl("code", { text: this.source });
      }
      return;
    }
    const editor = this.editor();
    const caption = editor && captionAtElement(editor, this.containerEl);
    const source = caption?.body ?? this.source;
    const empty = !source.trim();
    const status = caption && !caption.image ? orphanLabel : "";

    this.containerEl.toggleClass(`${captionClass}--editable`, !!caption);
    this.containerEl.toggleClass(`${captionClass}--hidden`, empty && !editor);
    const frame = this.containerEl.parentElement;
    if (frame?.matches(".el-pre") && frame.childElementCount === 1) {
      frame.toggleClass(`${captionClass}--hidden-frame`, empty && !editor);
    }
    this.status.hidden = !status;
    if (this.status.textContent !== status) this.status.setText(status);

    const placeholder = empty && !!editor;
    if (source === this.renderedSource && placeholder === this.showingPlaceholder) return;
    this.renderedSource = source;
    this.showingPlaceholder = placeholder;
    if (this.renderedChild) {
      this.removeChild(this.renderedChild);
      this.renderedChild = undefined;
    }
    this.body.empty();
    this.body.toggleClass(`${captionClass}__placeholder`, empty);
    if (empty) {
      if (editor) this.body.setText(emptyLabel);
      return;
    }
    const target = this.body.createDiv({ cls: `${captionClass}__markdown` });
    const component = this.addChild(new Component());
    this.renderedChild = component;
    void MarkdownRenderer.render(this.plugin.app, source, target, this.context.sourcePath, component).then(() => {
      if (!target.isConnected) return;
      refreshMath(this.containerEl);
      this.readingFigure?.schedule();
    }).catch(() => {
      target.setText(source);
    });
  }

  private edit(event: MouseEvent): void {
    const press = this.press;
    this.press = undefined;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.targetNode;
    if (target?.instanceOf(Element)) {
      const control = target.closest("a, button, input, textarea, select, summary, .image-caption-peng__scroll-math, [role=button], [contenteditable=true]");
      if (control && this.containerEl.contains(control)) return;
    }
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
    const selection = this.containerEl.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && this.containerEl.contains(selection.anchorNode)) return;

    const editor = this.editor();
    if (!editor) return;
    const caption = captionAtElement(editor, this.containerEl);
    if (!caption) return;

    event.preventDefault();
    event.stopPropagation();
    editor.dispatch({ selection: { anchor: caption.input }, scrollIntoView: true });
    editor.focus();
  }
}

class CaptionEditor {
  private readonly button: HTMLButtonElement;
  private frame?: number;
  private layoutPending = false;
  private compactDocument?: EditorView["state"]["doc"];
  private readonly compactPairs = new Map<number, CompactLines>();
  private compactSignature = "";
  private readonly resizeObserver?: ResizeObserver;
  private readonly observedFigureElements = new Set<HTMLElement>();
  private readonly indentation = new CaptionIndentation();
  private readonly nativeCaptionLines = new NativeCaptionLines();
  private readonly cssChanged: EventRef;
  private hovered?: { image: HTMLImageElement; from: number; doc: EditorView["state"]["doc"] };
  private pointer?: { x: number; y: number };
  private leaveTimer?: number;
  private controlObserver?: MutationObserver;
  private controlRoots: readonly HTMLElement[] = [];
  // Consume the second click at the former button position after it has disappeared.
  private lastAction?: { rect: DOMRect; until: number };

  constructor(
    private readonly view: EditorView,
    private readonly blocks: WeakMap<HTMLElement, CaptionBlock>,
    private readonly workspace: Workspace
  ) {
    this.cssChanged = workspace.on("css-change", this.imageChanged);
    this.button = view.dom.createEl("button", {
      cls: `${captionClass}__add`,
      attr: { type: "button", "aria-label": addLabel, title: addLabel }
    });
    this.button.hidden = true;
    setIcon(this.button, "plus");
    this.button.addEventListener("pointerdown", this.keepEditorFocus);
    this.button.addEventListener("click", this.activate);
    this.button.addEventListener("blur", this.pointerBlur);
    view.dom.addEventListener("pointerdown", this.skipRepeatedAction, true);
    view.dom.addEventListener("mousedown", this.skipRepeatedAction, true);
    view.dom.addEventListener("click", this.skipRepeatedAction, true);
    view.dom.addEventListener("dblclick", this.skipRepeatedAction, true);
    view.dom.addEventListener("pointerover", this.pointerMove);
    view.dom.addEventListener("pointermove", this.pointerMove);
    view.dom.addEventListener("pointerleave", this.pointerLeave);
    view.scrollDOM.addEventListener("scroll", this.scrollChanged, { passive: true });
    view.dom.addEventListener("load", this.imageChanged, true);
    view.dom.addEventListener("error", this.imageChanged, true);
    const win = view.dom.doc.defaultView;
    if (win) {
      this.resizeObserver = new win.ResizeObserver(this.imageChanged);
      this.resizeObserver.observe(view.scrollDOM);
    }
    this.queueRefresh();
  }

  update(update: ViewUpdate): void {
    const modeChanged = update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false);
    if (modeChanged) this.pointerLeave();
    if (update.docChanged) this.hideButton();
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || modeChanged ||
        update.transactions.some(transaction => transaction.reconfigured)) {
      this.queueRefresh();
    }
  }

  docViewUpdate(): void {
    this.queueRefresh();
  }

  destroy(): void {
    this.view.dom.removeEventListener("pointerdown", this.skipRepeatedAction, true);
    this.view.dom.removeEventListener("mousedown", this.skipRepeatedAction, true);
    this.view.dom.removeEventListener("click", this.skipRepeatedAction, true);
    this.view.dom.removeEventListener("dblclick", this.skipRepeatedAction, true);
    this.view.dom.removeEventListener("pointerover", this.pointerMove);
    this.view.dom.removeEventListener("pointermove", this.pointerMove);
    this.view.dom.removeEventListener("pointerleave", this.pointerLeave);
    this.view.scrollDOM.removeEventListener("scroll", this.scrollChanged);
    this.view.dom.removeEventListener("load", this.imageChanged, true);
    this.view.dom.removeEventListener("error", this.imageChanged, true);
    this.resizeObserver?.disconnect();
    this.workspace.offref(this.cssChanged);
    this.indentation.clear();
    this.nativeCaptionLines.clear();
    this.observedFigureElements.clear();
    this.button.removeEventListener("pointerdown", this.keepEditorFocus);
    this.button.removeEventListener("click", this.activate);
    this.button.removeEventListener("blur", this.pointerBlur);
    this.hideButton();
    if (this.frame !== undefined) this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.button.remove();
  }

  private readonly imageChanged = (): void => this.queueRefresh();
  private readonly scrollChanged = (): void => this.queueRefresh(false);

  private queueRefresh(layout = true): void {
    this.layoutPending ||= layout;
    if (this.frame !== undefined) return;
    this.frame = this.view.dom.ownerDocument.defaultView?.requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.layoutPending) {
        this.layoutPending = false;
        this.refreshCaptions();
      }
      this.refreshButton();
    });
  }

  private refreshCaptions(): void {
    const { doc } = this.view.state;
    if (doc !== this.compactDocument || !livePreview(this.view)) {
      this.compactDocument = doc;
      this.compactPairs.clear();
    }
    if (!livePreview(this.view)) {
      this.indentation.clear();
      this.nativeCaptionLines.clear(this.view);
      this.observeFigureElements(new Set());
      this.applyCompactLines();
      return;
    }

    const visible = this.view.viewport;
    for (const [opening] of this.compactPairs) {
      if (opening >= visible.from && opening <= visible.to) this.compactPairs.delete(opening);
    }
    const images = new Map<number, HTMLImageElement>();
    for (const image of this.view.contentDOM.querySelectorAll<HTMLImageElement>(".cm-line img[src]")) {
      const source = imageAtElement(this.view, image);
      if (source) images.set(source.from, image);
    }

    const visibleFigureElements = new Set<HTMLElement>();
    const indentPairs: { frame: HTMLElement; imageRow: HTMLElement; group: CompactLines; opening: number }[] = [];
    for (const element of this.view.contentDOM.querySelectorAll<HTMLElement>(`.${captionClass}`)) {
      const block = this.blocks.get(element);
      if (!block) continue;
      block.refresh();
      const frame = element.parentElement;
      const caption = captionAtElement(this.view, element);
      const image = caption?.image;
      const renderedImage = image && images.get(image.from);
      const rectangle = renderedImage?.getBoundingClientRect();
      if (!frame || !image || !caption || !renderedImage || !rectangle?.width || !rectangle.height) {
        clearFigureSize(element);
        continue;
      }
      visibleFigureElements.add(renderedImage);
      visibleFigureElements.add(frame);
      setFigureSize(element, rectangle, rectangle.left - frame.getBoundingClientRect().left);
      refreshMath(element);
      const opening = doc.line(caption.openLine);
      const first = doc.line(image.line + 1);
      const lines = [];
      for (let number = first.number; number <= opening.number; number++) {
        lines.push(doc.line(number).from);
      }
      const group = { from: first.from, to: doc.line(caption.endLine).to, lines };
      this.compactPairs.set(opening.from, group);
      const imageRow = renderedImage.closest<HTMLElement>(".cm-line.HyperMD-list-line");
      if (imageRow) indentPairs.push({ frame, imageRow, group, opening: opening.number });
    }
    this.nativeCaptionLines.update(this.view, captionIndex(doc).captions.values(), images, visibleFigureElements);
    this.observeFigureElements(visibleFigureElements);
    this.applyCompactLines();
    const indentation: IndentationPair[] = [];
    for (const { frame, imageRow, group, opening } of indentPairs) {
      if (!frame.isConnected || this.view.state.selection.ranges.some(range => range.from <= group.to && range.to >= group.from)) continue;
      const previous = frame.previousElementSibling;
      const origin = previous?.instanceOf(HTMLElement) && previous.hasClass("cm-line") &&
        doc.lineAt(this.view.posAtDOM(previous)).number === opening ? previous : undefined;
      indentation.push({ frame, imageRow, opening: origin });
    }
    this.indentation.update(indentation);
  }

  private observeFigureElements(visible: Set<HTMLElement>): void {
    for (const previous of this.observedFigureElements) {
      if (!visible.has(previous)) {
        this.resizeObserver?.unobserve(previous);
        this.observedFigureElements.delete(previous);
      }
    }
    for (const image of visible) {
      if (!this.observedFigureElements.has(image)) {
        this.resizeObserver?.observe(image);
        this.observedFigureElements.add(image);
      }
    }
  }

  private applyCompactLines(): void {
    const groups = [...this.compactPairs.values()].sort((left, right) => left.from - right.from);
    const signature = groups.map(group => `${group.from}:${group.to}:${group.lines.join(",")}`).join(" ");
    if (signature === this.compactSignature &&
        this.view.state.field(compactLinesField).groups.length === groups.length) return;
    this.compactSignature = signature;
    this.view.dispatch({ effects: setCompactLines.of(groups), annotations: Transaction.addToHistory.of(false) });
  }

  private readonly keepEditorFocus = (event: PointerEvent): void => {
    if (event.button === 0) event.preventDefault();
  };

  private readonly skipRepeatedAction = (event: MouseEvent): void => {
    const action = this.lastAction;
    if (!action || Date.now() > action.until || event.button !== 0 ||
        (event.type !== "pointerdown" && event.detail < 2)) return;
    if (!containsPoint(action.rect, event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!livePreview(this.view) || event.pointerType === "touch") return;
    this.pointer = { x: event.clientX, y: event.clientY };
    this.queueRefresh(false);
  };

  private readonly outsidePointerMove = (event: PointerEvent): void => {
    if (!this.view.dom.contains(event.targetNode)) this.pointerMove(event);
  };

  private readonly pointerLeave = (event?: PointerEvent): void => {
    if (event?.relatedTarget && this.hovered &&
        containsPoint(this.hovered.image.getBoundingClientRect(), event.clientX, event.clientY)) {
      this.pointerMove(event);
      return;
    }
    this.pointer = undefined;
    if (this.button.doc.activeElement !== this.button) this.hideButton();
  };

  private readonly pointerBlur = (): void => this.refreshButton();

  private refreshButton(): void {
    if (!livePreview(this.view)) {
      this.hideButton();
      return;
    }
    const { pointer } = this;
    const target = pointer ? this.view.dom.doc.elementFromPoint(pointer.x, pointer.y) : null;
    const overButton = this.button.contains(target) || this.button.doc.activeElement === this.button;
    const overAnchor = pointer && this.hovered &&
      containsPoint(this.hovered.image.getBoundingClientRect(), pointer.x, pointer.y);
    if (this.hovered && (overButton || overAnchor)) {
      const { image, from, doc } = this.hovered;
      if (doc !== this.view.state.doc || !this.imageNeedsCaption(image, from) || !this.positionButton(image, overButton)) {
        this.hideButton();
      } else {
        this.clearLeaveTimer();
      }
      return;
    }
    const line = target?.closest(".cm-line");
    if (pointer && line?.parentElement === this.view.contentDOM) {
      const image = [...line.querySelectorAll<HTMLImageElement>("img[src]")]
        .find(candidate => containsPoint(candidate.getBoundingClientRect(), pointer.x, pointer.y));
      const source = image && this.imageNeedsCaption(image);
      if (image && source && this.positionButton(image)) {
        this.clearLeaveTimer();
        const { doc } = this.view.state;
        this.hovered = { image, from: source.from, doc };
        this.view.dom.doc.addEventListener("pointermove", this.outsidePointerMove);
        this.button.hidden = false;
        return;
      }
    }
    if (this.hovered && this.leaveTimer === undefined) {
      this.leaveTimer = this.view.dom.doc.defaultView?.setTimeout(() => this.hideButton(), leaveDelay);
    }
  }

  private imageNeedsCaption(image: HTMLImageElement, from?: number): ImageSource | undefined {
    const source = imageAtElement(this.view, image);
    if (!source || (from !== undefined && source.from !== from)) return;
    if (!captionIndex(this.view.state.doc).captionedImages.has(source.from)) return source;
  }

  private positionButton(image: HTMLImageElement, keepCurrent = false): boolean {
    const picture = image.getBoundingClientRect();
    const pane = this.view.scrollDOM.getBoundingClientRect();
    const screen = this.view.dom.doc.documentElement;
    const clip = {
      left: Math.max(pane.left, 0), right: Math.min(pane.right, screen.clientWidth),
      top: Math.max(pane.top, 0), bottom: Math.min(pane.bottom, screen.clientHeight)
    };
    const selector = "button, a, [role=button], .embed-action, .image-resize-corner";
    const row = image.closest<HTMLElement>(".cm-line");
    if (!row) return false;
    const portals = this.controlPortals();
    const roots = [row, ...portals];
    const controls = roots.flatMap(root =>
      Array.from(root.querySelectorAll(selector)).filter(control => root === row || this.visibleControl(control)))
      .filter(control => !control.contains(image))
      .map(control => control.getBoundingClientRect())
      .filter(box => box.right > picture.left && box.left < picture.right &&
        box.bottom > picture.top && box.top < picture.bottom && box.width > 0 && box.height > 0);
    const externalControls = new Set<Element>();
    if (keepCurrent && !this.button.hidden) {
      const current = this.button.getBoundingClientRect();
      if (current.left >= Math.max(picture.left, clip.left) && current.top >= Math.max(picture.top, clip.top) &&
          current.right <= Math.min(picture.right, clip.right) && current.bottom <= Math.min(picture.bottom, clip.bottom) &&
          controls.every(box => current.right <= box.left || current.left >= box.right ||
            current.bottom <= box.top || current.top >= box.bottom) &&
          !this.externalControlAt({ left: current.left, top: current.top, size: current.width }, selector, externalControls)) {
        this.observeControls(roots);
        return true;
      }
    }
    let position = imageActionPosition(picture, clip, controls);
    // Other plugins can draw clickable image controls outside the editor DOM.
    while (position) {
      const overlap = this.externalControlAt(position, selector, externalControls);
      if (!overlap) break;
      externalControls.add(overlap);
      controls.push(overlap.getBoundingClientRect());
      position = imageActionPosition(picture, clip, controls);
    }
    const view = this.view.dom;
    const editor = view.getBoundingClientRect();
    if (!position || !editor.width || !editor.height) return false;

    // Image geometry is in viewport coordinates. The button lives in the editor's padding box.
    const scaleX = view.offsetWidth / editor.width;
    const scaleY = view.offsetHeight / editor.height;
    const properties = {
      "--image-caption-action-left": `${(position.left - editor.left) * scaleX - view.clientLeft}px`,
      "--image-caption-action-top": `${(position.top - editor.top) * scaleY - view.clientTop}px`,
      "--image-caption-action-width": `${position.size * scaleX}px`,
      "--image-caption-action-height": `${position.size * scaleY}px`
    };
    for (const [property, value] of Object.entries(properties)) {
      if (this.button.style.getPropertyValue(property) !== value) this.button.setCssProps({ [property]: value });
    }
    this.observeControls(roots);
    return true;
  }

  private visibleControl(control: Element): boolean {
    const style = this.view.dom.doc.defaultView?.getComputedStyle(control);
    return !!style && style.visibility === "visible" &&
      (style.pointerEvents !== "none" || Number(style.opacity) > 0);
  }

  private controlPortals(): HTMLElement[] {
    const view = this.view.dom;
    const win = view.doc.defaultView;
    if (!win) return [];
    return [...view.doc.body.children].filter((child): child is HTMLElement => {
      if (!child.instanceOf(HTMLElement) || child.contains(view)) return false;
      const position = win.getComputedStyle(child).position;
      return position === "fixed" || position === "absolute";
    });
  }

  private observeControls(roots: readonly HTMLElement[]): void {
    const doc = this.view.dom.doc;
    const win = doc.defaultView;
    if (!win || (roots.length === this.controlRoots.length && roots.every((root, index) => root === this.controlRoots[index]))) return;
    this.controlRoots = roots;
    this.controlObserver?.disconnect();
    this.controlObserver ??= new win.MutationObserver(() => this.queueRefresh(false));
    this.controlObserver.observe(doc.body, { childList: true });
    for (const root of roots) {
      this.controlObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    }
  }

  private externalControlAt(
    { left, top, size }: { left: number; top: number; size: number },
    selector: string,
    known: ReadonlySet<Element>
  ): Element | undefined {
    const doc = this.view.dom.doc;
    for (const x of [left + 1, left + size / 2, left + size - 1]) {
      for (const y of [top + 1, top + size / 2, top + size - 1]) {
        const hits = doc.elementsFromPoint(x, y);
        const topmost = hits[0];
        if (topmost && topmost !== doc.body && topmost !== doc.documentElement &&
            !this.view.dom.contains(topmost) && !known.has(topmost)) {
          const overlay = topmost.closest(selector) ?? topmost;
          if (!known.has(overlay)) return overlay;
        }
        const control = hits.map(element => element.closest(selector))
          .find(element => element && !this.view.dom.contains(element) && !known.has(element) && this.visibleControl(element));
        if (control) return control;
      }
    }
  }

  private clearLeaveTimer(): void {
    if (this.leaveTimer === undefined) return;
    this.view.dom.doc.defaultView?.clearTimeout(this.leaveTimer);
    this.leaveTimer = undefined;
  }

  private hideButton(): void {
    this.clearLeaveTimer();
    this.hovered = undefined;
    this.view.dom.doc.removeEventListener("pointermove", this.outsidePointerMove);
    this.controlObserver?.disconnect();
    this.controlRoots = [];
    this.button.hidden = true;
  }

  private readonly activate = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const anchor = this.hovered;
    const { doc } = this.view.state;
    const rect = this.button.getBoundingClientRect();
    this.pointer = undefined;
    this.hideButton();
    if (!anchor || anchor.doc !== doc || !livePreview(this.view)) return;
    const source = this.imageNeedsCaption(anchor.image, anchor.from);
    if (!source) return;

    this.lastAction = { rect, until: Date.now() + 500 };
    const { from, insert, cursor } = captionInsertion(doc, source, "comment");
    this.view.dispatch({
      changes: { from, insert },
      selection: { anchor: cursor },
      annotations: [Transaction.userEvent.of("input"), isolateHistory.of("full")],
      scrollIntoView: true
    });
    this.view.focus();
  };

}

export default class ImageCaptionPlugin extends Plugin {
  onload(): void {
    const blocks = new WeakMap<HTMLElement, CaptionBlock>();
    this.registerMarkdownCodeBlockProcessor(captionLanguage, (source, element, context) => {
      const block = new CaptionBlock(element, this, source, context);
      blocks.set(element, block);
      context.addChild(block);
    });
    const nativeReading = new NativeCaptionReading(this.app);
    this.register(() => nativeReading.destroy());
    this.registerMarkdownPostProcessor((section, context) => {
      context.addChild(new NativeCaptionReadingSection(section, nativeReading, context));
    });
    this.registerEditorExtension([captionIndentExtension(), compactLinesField, nativeCaptionRows, ViewPlugin.define(view => new CaptionEditor(view, blocks, this.app.workspace))]);
  }
}
