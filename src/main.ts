import { isolateHistory } from "@codemirror/commands";
import { Annotation, Prec, Transaction, type Text } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, Menu, Notice, Plugin, setIcon, TFile } from "obsidian";
import { canvasTextEditor, isCanvasTextEditor, type CanvasTextEditor } from "./canvas-text-editor";
import { CropModal } from "./crop-modal";
import { canRevealImage, canWrapImage, captionCursor, changeCrop, createCaptionRow, wrapImage, type FigureChange } from "./figure-change";
import { cropSupported, displayCrop, preserveWidthForResizeCommit } from "./figure-display";
import { figureContext, figureExtension } from "./figure-extension";
import { imageMovesWithChange, moveFigure, type FigureMove, type MoveDirection } from "./figure-move";
import { figureIndex, type Figure } from "./figure-source";
import { adjacentActionPosition, imageActionCompanion, imageActionGap, imageActionPosition, type ActionPosition } from "./image-action-placement";
import { isLocalImageTarget, resolveTarget } from "./image-target";
import { type ImageReference } from "./image-source";
import { legacyNoticeText, scanLegacyMarkers } from "./legacy-markers";
import { NativeCaptionLines, nativeCaptionRows } from "./native-caption-lines";
import { liveImageReference } from "./native-images";
import { FigureReading } from "./figure-reading";

interface EditorTarget {
  owner: object;
  path: string;
  writable: boolean;
}

interface EditTarget {
  doc: Text;
  editor: EditorTarget;
  reference: ImageReference;
  figure?: Figure;
}

const figureMovement = Annotation.define<boolean>();

function sameEditor(a: EditorTarget | undefined, b: EditorTarget | undefined): boolean {
  return a?.owner === b?.owner && a?.path === b?.path && a?.writable === b?.writable;
}

function actionButton(parent: HTMLElement, label: string, icon: string): HTMLButtonElement {
  const button = parent.createEl("button", { attr: { type: "button", "aria-label": label, title: label } });
  setIcon(button, icon);
  return button;
}

class FigureController {
  private readonly toolbar: HTMLElement;
  private readonly crop: HTMLButtonElement;
  private readonly caption: HTMLButtonElement;
  private readonly nativeCaptions = new NativeCaptionLines();
  private readonly observer: ResizeObserver;
  private readonly images = new Map<HTMLImageElement, EditTarget>();
  private observed = new Set<HTMLElement>();
  private canvas?: CanvasTextEditor;
  private projected?: EditorTarget;
  private hovering?: EditTarget;
  private expectedSelection?: number;
  private returns?: { doc: Text; imageFrom: number; editor: EditorTarget; epoch: number; steps: FigureMove[] };
  private pointer?: { x: number; y: number };
  private frame?: number;
  private measure = false;
  private readonly listeners: AbortController;

  constructor(private readonly view: EditorView, private readonly plugin: ImageEditorPlugin) {
    const win = view.dom.doc.defaultView ?? window;
    this.listeners = new win.AbortController();
    const signal = this.listeners.signal;
    this.observer = new win.ResizeObserver(() => this.schedule());
    this.observer.observe(view.scrollDOM);
    view.dom.addEventListener("focusin", () => this.plugin.editorFocused(view), { signal });
    this.toolbar = view.dom.createDiv({ cls: "live-image-editor-peng__actions", attr: { role: "group", "aria-label": "图片操作" } });
    this.toolbar.hidden = true;
    this.crop = actionButton(this.toolbar, "裁剪", "crop");
    this.caption = actionButton(this.toolbar, "添加图注", "plus");
    for (const [button, operation] of [[this.crop, "crop"], [this.caption, "caption"]] as const) {
      button.addEventListener("pointerdown", event => { if (event.button === 0) event.preventDefault(); }, { signal });
      button.addEventListener("click", event => {
        event.stopPropagation();
        if (this.hovering) this.open(this.hovering, operation);
      }, { signal });
    }
    view.dom.addEventListener("pointermove", event => {
      this.pointer = { x: event.clientX, y: event.clientY };
      this.schedule(false);
    }, { signal });
    view.dom.addEventListener("pointerleave", () => {
      this.pointer = undefined;
      this.schedule(false);
    }, { signal });
    view.contentDOM.addEventListener("mousedown", event => this.focusPlaceholder(event), { signal, capture: true });
    view.dom.doc.addEventListener("contextmenu", event => this.contextMenu(event), { signal, capture: true });
    view.dom.addEventListener("load", () => this.schedule(), { signal, capture: true });
    view.scrollDOM.addEventListener("scroll", () => this.schedule(), { signal, passive: true });
    win.addEventListener("pointerup", () => preserveWidthForResizeCommit(this.images.keys()), { signal, capture: true });
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.selectionSet) this.expectedSelection = undefined;
    if (update.docChanged) {
      this.hideToolbar();
      if (update.transactions.some(tr => tr.docChanged && !tr.annotation(figureMovement))) {
        this.returns = undefined;
        this.expectedSelection = undefined;
      }
    }
    if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet ||
        update.transactions.some(tr => tr.reconfigured)) this.schedule();
  }

  docViewUpdate(): void {
    this.schedule();
  }

  destroy(): void {
    this.listeners.abort();
    this.observer.disconnect();
    if (this.frame !== undefined) this.view.dom.win.cancelAnimationFrame(this.frame);
    for (const image of this.images.keys()) displayCrop(image);
    this.nativeCaptions.clear();
    this.toolbar.remove();
  }

  private editor(): EditorTarget | undefined {
    const { view } = this;
    if (!view.dom.isConnected || view.state.field(editorLivePreviewField, false) !== true) return;
    const file = view.state.field(editorInfoField, false)?.file;
    if (file) return { owner: file, path: file.path, writable: !view.state.readOnly };
    if (!this.canvas || !isCanvasTextEditor(this.canvas, view)) {
      this.canvas = canvasTextEditor(this.plugin.app.workspace.getLeavesOfType("canvas").map(leaf => leaf.view), view);
    }
    if (this.canvas) return { owner: this.canvas.node, path: "", writable: !view.state.readOnly };
  }

  private schedule(measure = true): void {
    this.measure ||= measure;
    this.frame ??= this.view.dom.win.requestAnimationFrame(() => {
      this.frame = undefined;
      const editor = this.editor();
      if (!!editor !== !!this.projected) this.view.dispatch({ effects: figureContext.of(!!editor) });
      if (this.measure || !sameEditor(editor, this.projected)) {
        this.measure = false;
        this.refreshImages(editor);
      }
      if (!sameEditor(editor, this.projected)) {
        this.returns = undefined;
        this.expectedSelection = undefined;
      }
      this.projected = editor;
      if (this.expectedSelection !== undefined && this.nativeSelected(editor)?.target.reference.from === this.expectedSelection) {
        this.expectedSelection = undefined;
      }
      this.refreshToolbar(editor);
    });
  }

  private refreshImages(editor?: EditorTarget): void {
    const { view } = this;
    const { doc } = view.state;
    const prior = new Set(this.images.keys());
    const observed = new Set<HTMLElement>();
    const byReference = new Map<number, HTMLImageElement>();
    this.images.clear();
    if (editor) {
      const figures = figureIndex(doc).figures;
      const byPosition = new Map(figures.map(figure => [figure.image.from, figure]));
      if (figures.length) {
        for (const image of view.contentDOM.querySelectorAll<HTMLImageElement>("img[src]")) {
          const reference = liveImageReference(this.plugin.app, editor.path, view, image);
          const figure = reference && byPosition.get(reference.from);
          if (!figure || !reference) continue;
          prior.delete(image);
          this.images.set(image, { doc, editor, reference, figure });
          byReference.set(reference.from, image);
          observed.add(image);
          displayCrop(image, isLocalImageTarget(reference.target) ? figure.crop : undefined);
        }
      }
      this.nativeCaptions.update(view, figures, byReference, view.state.field(figureExtension).reveal);
    } else this.nativeCaptions.clear(view);
    for (const image of prior) displayCrop(image);
    for (const item of this.observed) if (!observed.has(item)) this.observer.unobserve(item);
    for (const item of observed) if (!this.observed.has(item)) this.observer.observe(item);
    this.observed = observed;
  }

  private hideToolbar(): void {
    this.toolbar.hidden = true;
    this.hovering = undefined;
  }

  private target(image: HTMLImageElement, editor: EditorTarget, forSource = false): EditTarget | undefined {
    const known = this.images.get(image);
    if (known && this.valid(known)) return known;
    const { doc } = this.view.state;
    const reference = liveImageReference(this.plugin.app, editor.path, this.view, image);
    if (!reference) return;
    const figure = figureIndex(doc).figures.find(item => item.image.from === reference.from);
    if (figure || (forSource ? canRevealImage : canWrapImage)(doc, reference)) return { editor, doc, reference, figure };
  }

  private canCrop(target: EditTarget): boolean {
    return isLocalImageTarget(target.reference.target) && cropSupported(this.view.dom.doc.createElement("img"));
  }

  private blockers(host: Element | null, image: HTMLImageElement): DOMRect[] {
    const hits = [
      ...host?.querySelectorAll("button, a, [role=button], .embed-action, .image-resize-corner") ?? [],
      ...image.doc.querySelectorAll(".alp-image-visible, .image-resize-corner")
    ];
    const rect = image.getBoundingClientRect();
    return hits.filter(hit => !hit.contains(image)).map(hit => hit.getBoundingClientRect())
      .filter(box => box.width && box.height && box.right > rect.left && box.left < rect.right &&
        box.bottom > rect.top && box.top < rect.bottom + 24);
  }

  private refreshToolbar(editor?: EditorTarget): void {
    if (!editor?.writable) return this.hideToolbar();
    const { view, pointer } = this;
    const document = view.dom.doc;
    const hit = pointer && document.elementFromPoint(pointer.x, pointer.y);
    if (hit && this.toolbar.contains(hit) && this.hovering?.doc === view.state.doc) return;
    const host = hit?.closest(".cm-line, .cm-embed-block");
    const hovered = pointer && host && view.contentDOM.contains(host) && [...host.querySelectorAll<HTMLImageElement>("img[src]")].find(item => {
      const rect = item.getBoundingClientRect();
      return rect.left <= pointer.x && pointer.x <= rect.right && rect.top <= pointer.y && pointer.y <= rect.bottom;
    });
    const image = hovered || this.nativeSelected(editor)?.image;
    const target = image && this.target(image, editor);
    if (!image?.naturalWidth || !target || image.closest(".is-resizing")) return this.hideToolbar();
    const picture = image.getBoundingClientRect();
    const pane = view.scrollDOM.getBoundingClientRect();
    const clip = { left: Math.max(0, pane.left), top: Math.max(0, pane.top),
      right: Math.min(document.documentElement.clientWidth, pane.right),
      bottom: Math.min(document.documentElement.clientHeight, pane.bottom) };
    const controls = this.blockers(image.closest(".cm-line, .cm-embed-block"), image);
    const blocked = (pos: ActionPosition, adjacent = false) => {
      const inset = 1;
      const edge = pos.size - inset;
      const points = [[inset, inset], [edge, inset], [inset, edge], [edge, edge], [pos.size / 2, pos.size / 2]];
      return points.some(([x, y]) => {
        const tile = document.elementFromPoint(pos.left + x, pos.top + y);
        if (!tile || this.toolbar.contains(tile) || tile === image) return false;
        if (tile.closest("button, a, [role=button], .embed-action, .image-resize-corner, .alp-image-visible")) return true;
        if (!adjacent) return false;
        if (!view.dom.contains(tile)) return true;
        const row = tile.closest(".cm-line, .cm-embed-block");
        // A blank editor line can be the margin below the image. Keep nearby text, widgets, and the caption clear.
        return !!row && (row.matches(".image-caption-peng--native-empty, .image-caption-peng--native-line") ||
          !!row.textContent?.trim() || !!row.querySelector("img[src], [contenteditable=false]"));

      });
    };
    const canCrop = this.canCrop(target);
    const canCaption = !target.figure?.caption;
    if (!canCrop && !canCaption) return this.hideToolbar();
    let position = imageActionPosition(picture, clip, controls);
    let companion: ActionPosition | undefined;
    if (position && !blocked(position)) {
      companion = canCrop && canCaption ? imageActionCompanion(picture, clip, controls, position) : undefined;
      if (companion && blocked(companion)) companion = undefined;
    } else {
      position = adjacentActionPosition(picture, clip, controls);
      if (!position || blocked(position, true)) return this.hideToolbar();
      const second = { ...position, left: position.left + position.size + imageActionGap };
      if (canCrop && canCaption && second.left + second.size <= clip.right && !blocked(second, true)) companion = second;
    }
    this.crop.hidden = !canCrop;
    this.caption.hidden = !canCaption || canCrop && !companion;
    const box = view.dom.getBoundingClientRect();
    const scaleX = view.dom.offsetWidth / box.width;
    const scaleY = view.dom.offsetHeight / box.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return this.hideToolbar();
    this.toolbar.setCssProps({
      "--image-action-left": `${(position.left - box.left) * scaleX - view.dom.clientLeft}px`,
      "--image-action-top": `${(position.top - box.top) * scaleY - view.dom.clientTop}px`,
      "--image-action-width": `${position.size * scaleX}px`, "--image-action-height": `${position.size * scaleY}px`,
      "--image-action-gap": `${imageActionGap * scaleX}px`
    });
    this.hovering = target;
    this.toolbar.hidden = false;
  }

  private contextMenu(event: MouseEvent): void {
    const hit = event.targetNode;
    if (event.defaultPrevented || !hit?.instanceOf(Element)) return;
    let image: HTMLImageElement | undefined;
    if (hit.instanceOf(HTMLImageElement) && !hit.closest("a")) image = hit;
    else if (hit.closest(".alp-image-visible") && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Attachment Library can cover a tiny image completely. Its left-click action remains available.
      image = this.view.dom.doc.elementsFromPoint(event.clientX, event.clientY)
        .find((element): element is HTMLImageElement => element.instanceOf(HTMLImageElement));
    }
    if (!image || !this.view.contentDOM.contains(image)) return;
    const editor = this.editor();
    if (!editor?.writable) return;
    const edit = this.target(image, editor, true);
    if (!edit) return;
    const native = hit === image && !!image.closest(".image-embed");
    const menu = native ? Menu.forEvent(event) : new Menu().setUseNativeMenu(false);
    if (edit.figure || canWrapImage(edit.doc, edit.reference)) {
      if (this.canCrop(edit)) menu.addItem(item => item.setTitle("裁剪").setIcon("crop").onClick(() => this.open(edit, "crop")));
      menu.addItem(item => item.setTitle(edit.figure?.caption ? "编辑图注" : "添加图注").setIcon("plus")
        .onClick(() => this.open(edit, "caption")));
    }
    menu.addItem(item => item.setTitle("编辑 Markdown").setIcon("code").onClick(() => this.source(edit)));
    if (edit.figure) {
      for (const [direction, label, icon] of [["up", "上移一级", "outdent"], ["down", "下移一级", "indent"]] as const) {
        const move = this.plannedMove(edit, direction);
        if (move) menu.addItem(item => item.setTitle(label).setIcon(icon).onClick(() => {
          if (this.valid(edit)) this.view.focus();
          this.move(edit, direction);
        }));
      }
    }
    if (!native) {
      event.preventDefault();
      event.stopPropagation();
      menu.showAtMouseEvent(event);
    }
  }

  private focusPlaceholder(event: MouseEvent): void {
    const node = event.targetNode;
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !node?.instanceOf(HTMLElement) || node.closest("a, button")) return;
    const row = node.closest(".image-caption-peng--native-empty");
    const editor = row && this.editor();
    if (!row || !editor?.writable) return;
    const { doc } = this.view.state;
    const number = doc.lineAt(this.view.posAtDOM(row)).number;
    const figure = figureIndex(doc).figures.find(item => !item.caption &&
      number > doc.lineAt(item.image.from).number && number <= doc.lineAt(item.closing.from).number);
    if (!figure) return;
    event.preventDefault();
    event.stopPropagation();
    this.editCaption({ editor, doc, reference: figure.image, figure });
  }

  private nativeSelected(editor = this.editor()): { image: HTMLImageElement; target: EditTarget } | undefined {
    const { view } = this;
    const { selection } = view.state;
    if (!editor?.writable || selection.ranges.length !== 1 || !selection.main.empty) return;
    const matches = view.contentDOM.querySelectorAll<HTMLImageElement>(".image-embed.is-selected img[src]");
    if (matches.length !== 1) return;
    const image = matches[0];
    if (image.closest(".is-resizing")) return;
    const target = this.target(image, editor, true);
    if (!target?.figure || (selection.main.head !== target.reference.from && selection.main.head !== target.reference.to)) return;
    return { image, target };
  }

  private plannedMove(target: EditTarget, direction: MoveDirection): FigureMove | undefined {
    if (!target.figure) return;
    const previous = this.returns;
    if (direction === "down" && previous?.doc === target.doc && previous.imageFrom === target.reference.from &&
        previous.epoch === this.plugin.editorEpoch && sameEditor(previous.editor, target.editor)) {
      const step = previous.steps.at(-1);
      if (step) return step;
    }
    return moveFigure(target.doc, target.figure, direction);
  }

  moveSelected(direction: MoveDirection): boolean {
    if (!this.view.hasFocus || this.view.composing) return false;
    const selected = this.nativeSelected();
    if (!selected) return false;
    const { target } = selected;
    // Wait for Obsidian to confirm the relocated image before allowing another shortcut.
    if (this.expectedSelection !== undefined && target.reference.from !== this.expectedSelection) return false;
    const move = this.plannedMove(target, direction);
    if (!move) return true;
    if (!imageMovesWithChange(target.reference.from, target.reference.to, move)) return true;
    this.move(target, direction, move);
    this.expectedSelection = move.imageFrom;
    return true;
  }

  private move(target: EditTarget, direction: MoveDirection, planned?: FigureMove): void {
    if (!target.editor.writable || !this.valid(target)) {
      this.stale();
      return;
    }
    const move = planned ?? this.plannedMove(target, direction);
    if (!move) return;
    const previous = this.returns;
    const epoch = this.plugin.editorEpoch;
    const steps = previous?.doc === target.doc && previous.imageFrom === target.reference.from &&
      previous.epoch === epoch && sameEditor(previous.editor, target.editor) ? [...previous.steps] : [];
    if (direction === "up") steps.push({
      changes: move.changes.invert(target.doc), imageFrom: target.reference.from, imageTo: target.reference.to
    });
    else if (steps.at(-1) === move) steps.pop();
    else steps.length = 0;
    this.view.dispatch({
      changes: move.changes,
      effects: EditorView.scrollIntoView(move.imageFrom, { y: "nearest" }),
      annotations: [figureMovement.of(true), Transaction.userEvent.of("move.figure"), isolateHistory.of("full")]
    });
    this.returns = steps.length ? { doc: this.view.state.doc, imageFrom: move.imageFrom, editor: target.editor, epoch, steps } : undefined;
  }

  private valid(target: EditTarget): boolean {
    return target.doc === this.view.state.doc && sameEditor(target.editor, this.editor());
  }

  private source(target: EditTarget): void {
    if (!this.valid(target)) return;
    this.view.dispatch({ selection: { anchor: target.figure?.opening.from ?? target.reference.from },
      scrollIntoView: true });
    this.view.focus();
  }

  private commit(target: EditTarget, change: FigureChange, cursor?: number): boolean {
    if (!target.editor.writable || !this.valid(target)) return this.stale();
    this.view.dispatch({ changes: change, annotations: [Transaction.userEvent.of("input"), isolateHistory.of("full")],
      selection: cursor === undefined ? undefined : { anchor: cursor }, scrollIntoView: cursor !== undefined });
    return true;
  }

  private editCaption(target: EditTarget): void {
    if (!this.valid(target)) return;
    const cursor = target.figure && captionCursor(target.doc, target.figure);
    if (cursor !== undefined) {
      this.view.dispatch({ selection: { anchor: cursor }, scrollIntoView: true });
    } else {
      const edit = target.figure ? createCaptionRow(target.doc, target.figure) :
        wrapImage(target.doc, target.reference, { forCaption: true });
      if (!edit) {
        new Notice("无法在此处添加图注。");
        return;
      }
      if (!this.commit(target, edit.changes, edit.cursor)) return;
    }
    this.view.focus();
  }

  private open(target: EditTarget, operation: "crop" | "caption"): void {
    if (!target.editor.writable || !this.valid(target)) return;
    this.hideToolbar();
    this.pointer = undefined;
    if (operation === "caption") return this.editCaption(target);
    const url = this.canCrop(target) && resolveTarget(this.plugin.app, target.reference.target, target.editor.path);
    if (!url) return;
    this.plugin.showModal(new CropModal(this.plugin.app, url, target.figure?.crop, crop => {
      if (!this.valid(target)) return this.stale();
      const change = target.figure ? changeCrop(target.figure, crop) : wrapImage(target.doc, target.reference, { crop })?.changes;
      if (change) return this.commit(target, change);
      if (target.figure || !crop || (crop[0] === 0 && crop[1] === 0 && crop[2] === 1 && crop[3] === 1)) return true;
      new Notice("此改动无法保留图块的 Markdown 结构，请检查内容。");
      return false;
    }, () => {
      if (this.view.dom.isConnected && sameEditor(target.editor, this.editor())) this.view.focus();
    }));
  }

  private stale(): false {
    new Notice("图片所在的文档已变动，请重新打开操作。");
    return false;
  }
}

export default class ImageEditorPlugin extends Plugin {
  private modal?: CropModal;
  private focusedEditor?: EditorView;
  private readonly legacyChecked = new Set<string>();
  private legacyNotices = 0;
  private disposed = false;
  editorEpoch = 0;

  editorFocused(view: EditorView): void {
    if (this.focusedEditor === view) return;
    this.focusedEditor = view;
    this.editorEpoch++;
  }

  showModal(modal: CropModal): void {
    this.modal?.close();
    this.modal = modal;
    modal.open();
  }

  /** Warns once per note when it still carries pre-0.3 markers, which no longer render. */
  private async checkLegacy(file: TFile | null): Promise<void> {
    const target = file ?? this.app.workspace.getActiveFile();
    if (this.disposed || !target || target.extension !== "md" || target.stat.size > 2_000_000) return;
    if (this.legacyChecked.has(target.path) || this.legacyNotices >= 3) return;
    this.legacyChecked.add(target.path);
    let text: string;
    try {
      text = await this.app.vault.cachedRead(target);
    } catch {
      return;
    }
    if (this.disposed) return;
    const message = legacyNoticeText(scanLegacyMarkers(text));
    if (!message) return;
    this.legacyNotices++;
    new Notice(message, 12000);
  }

  onload(): void {
    const controller = ViewPlugin.define(view => new FigureController(view, this));
    const reading = new FigureReading(this.app);
    this.register(() => reading.destroy());
    this.registerMarkdownPostProcessor((section, context) => context.addChild(reading.child(section, context)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { this.editorEpoch++; }));
    this.registerEvent(this.app.workspace.on("file-open", file => { void this.checkLegacy(file); }));
    this.app.workspace.onLayoutReady(() => { void this.checkLegacy(this.app.workspace.getActiveFile()); });
    const moveKeys = Prec.highest(keymap.of([{
      key: "Tab",
      run: view => view.plugin(controller)?.moveSelected("down") ?? false,
      shift: view => view.plugin(controller)?.moveSelected("up") ?? false
    }]));
    this.registerEditorExtension([figureExtension, nativeCaptionRows, controller, moveKeys]);
  }

  onunload(): void {
    this.disposed = true;
    this.modal?.close();
    this.modal = undefined;
  }
}
