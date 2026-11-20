export const captionClass = "image-caption-peng";
const pairedClass = `${captionClass}--paired`;
const overflowingMath = `${captionClass}__scroll-math`;

function setCss(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) !== value) element.setCssProps({ [property]: value });
}

export function setFigureSize(element: HTMLElement, picture: DOMRectReadOnly, offset: number): void {
  setCss(element, "--image-caption-width", `${picture.width}px`);
  setCss(element, "--image-caption-offset", `${offset}px`);
  if (!element.hasClass(pairedClass)) element.addClass(pairedClass);
  setCss(element, "--image-caption-padding", picture.width <= 120 ? "4px" : "6px");
  const gap = element.getBoundingClientRect().top - picture.bottom;
  setCss(element, "--image-caption-seam", `${gap > 0 && gap <= 6 ? gap : 0}px`);
}

export function clearFigureSize(element: HTMLElement): void {
  element.removeClass(pairedClass);
  element.style.removeProperty("--image-caption-width");
  element.style.removeProperty("--image-caption-offset");
  element.style.removeProperty("--image-caption-padding");
  element.style.removeProperty("--image-caption-seam");
  refreshMath(element);
}

export function refreshMath(element: HTMLElement): void {
  const math = element.querySelectorAll<HTMLElement>("mjx-container");
  const paired = element.hasClass(pairedClass);
  const style = element.doc.defaultView?.getComputedStyle(element);
  const width = element.clientWidth - (Number.parseFloat(style?.paddingLeft ?? "") || 0) -
    (Number.parseFloat(style?.paddingRight ?? "") || 0);
  for (const formula of math) {
    const content = formula.querySelector("mjx-math");
    const overflow = paired && !!content && content.getBoundingClientRect().width > width + 1;
    if (formula.hasClass(overflowingMath) === overflow) continue;
    formula.toggleClass(overflowingMath, overflow);
    if (overflow && !formula.hasAttribute("tabindex")) {
      formula.setAttr("tabindex", "0");
      formula.dataset.imageCaptionTabStop = "true";
    } else if (!overflow && formula.dataset.imageCaptionTabStop === "true") {
      formula.removeAttribute("tabindex");
      delete formula.dataset.imageCaptionTabStop;
    }
  }
}
