import { Modal, type App } from "obsidian";
import { cropHandles, moveCrop, type Crop, type CropHandle } from "./crop-state";

const fullImage: Crop = [0, 0, 1, 1];
export class CropModal extends Modal {
  private crop: Crop;

  constructor(app: App, private readonly url: string, private readonly initial: Crop | undefined,
    private readonly save: (crop?: Crop) => boolean, private readonly closed: () => void) {
    super(app);
    this.crop = initial ?? fullImage;
  }

  onOpen(): void {
    this.setTitle("裁剪图片");
    this.modalEl.addClass("live-image-editor-peng__modal");
    const stage = this.contentEl.createDiv({ cls: "live-image-editor-peng__crop-stage" });
    const image = stage.createEl("img", { attr: { src: this.url, alt: "原图", draggable: "false" } });
    const selection = stage.createDiv({ cls: "live-image-editor-peng__selection", attr: { "data-handle": "move" } });
    for (const handle of cropHandles) selection.createSpan({ attr: { "data-handle": handle } });
    const controls = this.contentEl.createDiv({ cls: "modal-button-container" });
    const confirm = controls.createEl("button", { text: "确认裁剪", cls: "mod-cta", attr: { type: "button" } });
    const cancel = controls.createEl("button", { text: "取消", attr: { type: "button" } });
    confirm.disabled = true;
    confirm.addEventListener("click", () => {
      if (this.save(this.crop)) this.close();
    });
    cancel.addEventListener("click", () => this.close());
    if (this.initial) {
      const restore = controls.createEl("button", { text: "恢复原图", attr: { type: "button" } });
      restore.addEventListener("click", () => {
        if (this.save()) this.close();
      });
    }

    let drag: { id: number; x: number; y: number; crop: Crop; handle: CropHandle } | undefined;
    const draw = () => {
      const [x, y, width, height] = this.crop;
      selection.setCssProps({ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` });
    };
    selection.addEventListener("pointerdown", event => {
      if (event.button !== 0 || drag || confirm.disabled) return;
      const handle = (event.target as HTMLElement).dataset.handle as CropHandle;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, crop: this.crop, handle };
      selection.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    selection.addEventListener("pointermove", event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!(event.buttons & 1)) {
        drag = undefined;
        return;
      }
      const bounds = stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      this.crop = moveCrop(drag.crop, drag.handle, (event.clientX - drag.x) / bounds.width,
        (event.clientY - drag.y) / bounds.height, Math.min(drag.crop[2], 12 / bounds.width),
        Math.min(drag.crop[3], 12 / bounds.height));
      draw();
    });
    const endDrag = () => { drag = undefined; };
    selection.addEventListener("pointerup", endDrag);
    selection.addEventListener("pointercancel", endDrag);
    selection.addEventListener("lostpointercapture", endDrag);
    stage.hidden = true;
    void image.decode().then(() => {
      stage.hidden = false;
      draw();
      confirm.disabled = false;
    }).catch(() => {
      if (this.contentEl.isConnected) this.contentEl.createEl("p", { text: "无法加载原图。" });
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.closed();
  }
}
