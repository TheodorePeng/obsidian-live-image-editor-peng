import { cropInset, cropWidthForHeight, type Crop } from "./crop-state";

export const cropClass = "live-image-editor-peng--cropped";

export function cropSupported(image: HTMLImageElement): boolean {
  return image.ownerDocument.defaultView?.CSS.supports("object-view-box", "inset(1%)") ?? false;
}

export function displayCrop(image: HTMLImageElement, crop?: Crop): void {
  if (crop && cropSupported(image) && image.naturalWidth && image.naturalHeight) {
    image.style.setProperty("--live-image-editor-crop-inset", cropInset(crop));
    const limit = cropWidthForHeight(crop, image.naturalWidth, image.naturalHeight, image.getAttribute("height"));
    if (limit !== undefined) image.style.setProperty("--live-image-editor-crop-height-width", limit + "px");
    else image.style.removeProperty("--live-image-editor-crop-height-width");
    image.addClass(cropClass);
  } else if (image.hasClass(cropClass)) {
    image.removeClass(cropClass);
    image.style.removeProperty("--live-image-editor-crop-inset");
    image.style.removeProperty("--live-image-editor-crop-height-width");
  }
}

export function preserveWidthForResizeCommit(images: Iterable<HTMLImageElement>): void {
  const commit = "live-image-editor-peng--resize-commit";
  for (const image of images) {
    if (!image.hasClass(cropClass) || !image.hasAttribute("height") || !image.closest(".is-resizing")) continue;
    // Obsidian clears its drag state before reading clientWidth on pointerup.
    image.addClass(commit);
    image.win.requestAnimationFrame(() => image.removeClass(commit));
  }
}
