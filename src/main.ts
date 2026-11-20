import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  editorInfoField,
  editorLivePreviewField,
  Notice,
  Plugin,
  setIcon,
  type EventRef,
  type Workspace
} from "obsidian";
import { captionIndex, captionInsertion, type ImageSource } from "./caption-source";
import { captionClass } from "./figure-layout";
import { NativeCaptionReading, NativeCaptionReadingSection } from "./native-caption-reading";
import { NativeCaptionLines, nativeCaptionRows } from "./native-caption-lines";
import { imageActionPosition } from "./image-action-placement";
import { captionIndentExtension } from "./indent-extension";
import { CropDisplay, CropReadingSection, liveImagePairs, supportsCrop } from "./crop-render";
import { cropMarkers } from "./crop-markers";
import { CropModal } from "./crop-modal";
import { cropChange, type Crop } from "./crop-state";
import { isLocalImageTarget, resolveTarget } from "./image-target";
import type { ImageReference } from "./image-source";

const addLabel = "添加图注";
const cropLabel = "裁剪";
const leaveDelay = 180;

function livePreview(view: EditorView): boolean {
  return view.state.field(editorLivePreviewField, false) === true;
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

class ImageActions {
  private readonly button: HTMLButtonElement;
  private readonly cropButton: HTMLButtonElement;
  private readonly cropDisplay = new CropDisplay();
  private imagePairs = new Map<HTMLImageElement, ImageReference>();
  private frame?: number;
  private layoutPending = false;
  private readonly resizeObserver?: ResizeObserver;
  private readonly observedFigureElements = new Set<HTMLElement>();
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
    private readonly workspace: Workspace,
    private readonly plugin: ImageEditorPlugin
  ) {
    this.cssChanged = workspace.on("css-change", this.imageChanged);
    this.button = this.createAction(addLabel, "plus", this.activate);
    this.cropButton = this.createAction(cropLabel, "crop", this.activateCrop);
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

  private createAction(label: string, icon: string, activate: (event: MouseEvent) => void): HTMLButtonElement {
    const button = this.view.dom.createEl("button", {
      cls: `${captionClass}__add`,
      attr: { type: "button", "aria-label": label, title: label }
    });
    button.hidden = true;
    setIcon(button, icon);
    button.addEventListener("pointerdown", this.keepEditorFocus);
    button.addEventListener("click", activate);
    button.addEventListener("blur", this.pointerBlur);
    return button;
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
    this.nativeCaptionLines.clear();
    this.observedFigureElements.clear();
    this.button.removeEventListener("pointerdown", this.keepEditorFocus);
    this.button.removeEventListener("click", this.activate);
    this.button.removeEventListener("blur", this.pointerBlur);
    this.hideButton();
    if (this.frame !== undefined) this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.button.remove();
    this.cropButton.remove();
    this.cropDisplay.clear();
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
    if (!livePreview(this.view)) {
      this.cropDisplay.clear();
      this.imagePairs.clear();
      this.nativeCaptionLines.clear(this.view);
      this.observeFigureElements(new Set());
      return;
    }

    const path = this.view.state.field(editorInfoField, false)?.file?.path;
    this.imagePairs = path ? liveImagePairs(this.plugin.app, path, this.view) : new Map<HTMLImageElement, ImageReference>();
    this.cropDisplay.update(this.imagePairs);

    const images = new Map<number, HTMLImageElement>();
    for (const image of this.view.contentDOM.querySelectorAll<HTMLImageElement>(".cm-line img[src]")) {
      const source = imageAtElement(this.view, image);
      if (source) images.set(source.from, image);
    }

    const visibleFigureElements = new Set<HTMLElement>();
    this.nativeCaptionLines.update(this.view, captionIndex(doc).captions.values(), images, visibleFigureElements);
    this.observeFigureElements(visibleFigureElements);
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
    if (!this.actionFocused()) this.hideButton();
  };

  private readonly pointerBlur = (): void => this.refreshButton();

  private actionFocused(): boolean {
    const active = this.button.doc.activeElement;
    return active === this.button || active === this.cropButton;
  }

  private refreshButton(): void {
    if (!livePreview(this.view)) {
      this.hideButton();
      return;
    }
    const { pointer } = this;
    const target = pointer ? this.view.dom.doc.elementFromPoint(pointer.x, pointer.y) : null;
    const overButton = this.button.contains(target) || this.cropButton.contains(target) || this.actionFocused();
    const overAnchor = pointer && this.hovered &&
      containsPoint(this.hovered.image.getBoundingClientRect(), pointer.x, pointer.y);
    if (this.hovered && (overButton || overAnchor)) {
      if (this.hovered.doc !== this.view.state.doc || !this.positionActions(this.hovered.image, overButton)) {
        this.hideButton();
      } else {
        this.clearLeaveTimer();
      }
      return;
    }
    const host = target?.closest(".cm-line, .cm-embed-block");
    if (pointer && host && this.view.contentDOM.contains(host)) {
      const image = [...host.querySelectorAll<HTMLImageElement>("img[src]")]
        .find(candidate => containsPoint(candidate.getBoundingClientRect(), pointer.x, pointer.y));
      if (image && this.positionActions(image)) {
        const source = this.cropReference(image) ?? this.imageNeedsCaption(image);
        if (source) {
          this.clearLeaveTimer();
          const { doc } = this.view.state;
          this.hovered = { image, from: source.from, doc };
          this.view.dom.doc.addEventListener("pointermove", this.outsidePointerMove);
          return;
        }
      }
    }
    if (this.hovered && this.leaveTimer === undefined) {
      this.leaveTimer = this.view.dom.doc.defaultView?.setTimeout(() => this.hideButton(), leaveDelay);
    }
  }

  private cropReference(image: HTMLImageElement): ImageReference | undefined {
    const source = this.imagePairs.get(image);
    if (source && image.isConnected && image.naturalWidth && image.naturalHeight &&
        isLocalImageTarget(source.target) &&
        (!source.marker || source.marker.crop) && supportsCrop(image)) return source;
  }

  private positionActions(image: HTMLImageElement, keepCurrent = false): boolean {
    this.button.hidden = !this.imageNeedsCaption(image) || !this.positionButton(image, this.button, keepCurrent);
    this.cropButton.hidden = !this.cropReference(image) ||
      !this.positionButton(image, this.cropButton, keepCurrent, this.button.hidden ? undefined : this.button.getBoundingClientRect());
    return !this.button.hidden || !this.cropButton.hidden;
  }

  private imageNeedsCaption(image: HTMLImageElement, from?: number): ImageSource | undefined {
    const source = imageAtElement(this.view, image);
    if (!source || (from !== undefined && source.from !== from)) return;
    if (!captionIndex(this.view.state.doc).captionedImages.has(source.from)) return source;
  }

  private positionButton(image: HTMLImageElement, button: HTMLButtonElement, keepCurrent: boolean,
    other?: DOMRect): boolean {
    const picture = image.getBoundingClientRect();
    const pane = this.view.scrollDOM.getBoundingClientRect();
    const screen = this.view.dom.doc.documentElement;
    const clip = {
      left: Math.max(pane.left, 0), right: Math.min(pane.right, screen.clientWidth),
      top: Math.max(pane.top, 0), bottom: Math.min(pane.bottom, screen.clientHeight)
    };
    const selector = "button, a, [role=button], .embed-action, .image-resize-corner";
    const row = image.closest<HTMLElement>(".cm-line, .cm-embed-block");
    if (!row) return false;
    const portals = this.controlPortals();
    const roots = [row, ...portals];
    const controls = roots.flatMap(root =>
      Array.from(root.querySelectorAll(selector)).filter(control => root === row || this.visibleControl(control)))
      .filter(control => !control.contains(image))
      .map(control => control.getBoundingClientRect())
      .filter(box => box.right > picture.left && box.left < picture.right &&
        box.bottom > picture.top && box.top < picture.bottom && box.width > 0 && box.height > 0);
    if (other) controls.push(other);
    const side = button === this.cropButton ? "right" : "left";
    const externalControls = new Set<Element>();
    if (keepCurrent && !button.hidden) {
      const current = button.getBoundingClientRect();
      if (current.left >= Math.max(picture.left, clip.left) && current.top >= Math.max(picture.top, clip.top) &&
          current.right <= Math.min(picture.right, clip.right) && current.bottom <= Math.min(picture.bottom, clip.bottom) &&
          controls.every(box => current.right <= box.left || current.left >= box.right ||
            current.bottom <= box.top || current.top >= box.bottom) &&
          !this.externalControlAt({ left: current.left, top: current.top, size: current.width }, selector, externalControls)) {
        this.observeControls(roots);
        return true;
      }
    }
    let position = imageActionPosition(picture, clip, controls, side);
    // Other plugins can draw clickable image controls outside the editor DOM.
    while (position) {
      const overlap = this.externalControlAt(position, selector, externalControls);
      if (!overlap) break;
      externalControls.add(overlap);
      controls.push(overlap.getBoundingClientRect());
      position = imageActionPosition(picture, clip, controls, side);
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
      if (button.style.getPropertyValue(property) !== value) button.setCssProps({ [property]: value });
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
    this.cropButton.hidden = true;
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
    const { from, insert, cursor } = captionInsertion(doc, source);
    this.view.dispatch({
      changes: { from, insert },
      selection: { anchor: cursor },
      annotations: [Transaction.userEvent.of("input"), isolateHistory.of("full")],
      scrollIntoView: true
    });
    this.view.focus();
  };

  private readonly activateCrop = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const anchor = this.hovered;
    this.pointer = undefined;
    this.hideButton();
    const { view } = this;
    const { doc } = view.state;
    if (!anchor || anchor.doc !== doc || !livePreview(view)) return;
    const source = this.cropReference(anchor.image);
    const path = view.state.field(editorInfoField, false)?.file?.path;
    if (!source || source.from !== anchor.from || !path) return;
    const url = resolveTarget(this.plugin.app, source.target, path);
    if (!url) return;

    this.plugin.openCrop(url, source.marker?.crop, crop => {
      if (!view.dom.isConnected || !livePreview(view) || view.state.doc !== doc ||
          view.state.field(editorInfoField, false)?.file?.path !== path) {
        new Notice("笔记已变动，请重新打开裁剪。");
        return false;
      }
      const changes = cropChange(doc, source.to, crop);
      if (changes) {
        view.dispatch({
          changes,
          annotations: [Transaction.userEvent.of("input"), isolateHistory.of("full")]
        });
      }
      view.focus();
      return true;
    });
  };

}

export default class ImageEditorPlugin extends Plugin {
  private cropModal?: CropModal;
  private readonly cropSections = new Set<CropReadingSection>();

  openCrop(url: string, crop: Crop | undefined, save: (crop?: Crop) => boolean): void {
    this.cropModal?.close();
    const modal = new CropModal(this.app, url, crop, save, () => {
      if (this.cropModal === modal) this.cropModal = undefined;
    });
    this.cropModal = modal;
    modal.open();
  }

  onunload(): void {
    this.cropModal?.close();
    for (const section of this.cropSections) section.stop();
    this.cropSections.clear();
  }

  onload(): void {
    const nativeReading = new NativeCaptionReading(this.app);
    this.register(() => nativeReading.destroy());
    this.registerMarkdownPostProcessor((section, context) => {
      context.addChild(new NativeCaptionReadingSection(section, nativeReading, context));
      const crop = new CropReadingSection(section, this.app, context);
      this.cropSections.add(crop);
      crop.register(() => this.cropSections.delete(crop));
      context.addChild(crop);
    });
    this.registerEditorExtension([captionIndentExtension(), nativeCaptionRows, cropMarkers, ViewPlugin.define(view => new ImageActions(view, this.app.workspace, this))]);
  }
}
