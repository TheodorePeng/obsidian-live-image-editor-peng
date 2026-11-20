import { StateEffect, StateField, Transaction, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { columns, type CaptionSource } from "./caption-source";
import { captionClass, refreshMath } from "./figure-layout";
import { readIndentationGuides } from "./indentation-guides";

const body = `${captionClass}--native-line`;
const spacer = `${captionClass}--native-spacer`;
const hidden = `${captionClass}--native-marker`;
const placeholder = `${captionClass}--native-empty`;
const mathClass = `${captionClass}--native-math`;
const aligned = `${captionClass}--native-aligned`;
const gutterProperty = "--image-caption-gutter";
const widthProperty = "--image-caption-width";
const baseProperty = "--image-caption-base";
const fontProperty = "--image-caption-editor-font";
const guidesProperty = "--image-caption-native-guides";
const guideShiftProperty = "--image-caption-native-guide-shift";
const borderProperty = "--image-caption-row-border";
const paddingProperty = "--image-caption-text-padding";
const indentProperty = "--image-caption-text-indent";

interface GuideGeometry {
  offset: number;
  width: number;
  color: string;
}

interface FigureGeometry {
  offset: number;
  width: number;
  font: string;
  guides: GuideGeometry[];
}

interface Alignment {
  padding: number;
  indent: number;
  paddingShift: number;
  indentShift: number;
}

interface RowStyle {
  from: number;
  style: string;
  gutter: number;
  width: number;
  base: number;
  border: number;
  font: string;
  guides: string;
  guideShift: number;
  alignment?: Alignment;
}

const setNativeRows = StateEffect.define<readonly RowStyle[]>();

function rowAttributes(row: RowStyle): string {
  const geometry = `${gutterProperty}:${row.gutter}px;${widthProperty}:${row.width}px;${baseProperty}:${row.base}px;${borderProperty}:${row.border}px`;
  const guides = `${fontProperty}:${row.font};${guidesProperty}:${row.guides};${guideShiftProperty}:${row.guideShift}px`;
  const alignment = row.alignment
    ? `;${paddingProperty}:${row.alignment.padding}px;${indentProperty}:${row.alignment.indent}px`
    : "";
  return geometry + ";" + guides + alignment;
}

export const nativeCaptionRows = StateField.define<{ styles: readonly RowStyle[]; decorations: DecorationSet }>({
  create: () => ({ styles: [], decorations: Decoration.none }),
  update(current, transaction) {
    const update = transaction.effects.find(effect => effect.is(setNativeRows));
    if (!update) return transaction.docChanged ? { styles: [], decorations: Decoration.none } : current;
    return {
      styles: update.value,
      decorations: Decoration.set(update.value.map(line => Decoration.line({
        class: line.alignment ? `${line.style} ${aligned}` : line.style,
        attributes: { style: rowAttributes(line) }
      }).range(line.from)), true)
    };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations)
});

function alignText(view: EditorView, row: HTMLElement, lineFrom: number, text: string, ownerIndent: number,
  gutter: number, imageWidth: number, previous: Alignment | undefined): Alignment | undefined {
  const whitespace = /^[ \t]*/.exec(text)?.[0] ?? "";
  if (whitespace.length === text.length) return;
  const first = view.coordsAtPos(lineFrom + whitespace.length, -1);
  if (!first) return;
  const left = row.getBoundingClientRect().left;
  const computed = row.win.getComputedStyle(row);
  const border = row.clientLeft;
  const padding = Number.parseFloat(computed.paddingInlineStart) || 0;
  const indent = Number.parseFloat(computed.textIndent) || 0;
  const inlinePadding = Number.parseFloat(row.style.paddingInlineStart);
  const inlineIndent = Number.parseFloat(row.style.textIndent);
  // Obsidian and other extensions can update their inline values without removing our decoration.
  const nativePadding = Number.isFinite(inlinePadding) ? inlinePadding : padding - (previous?.paddingShift ?? 0);
  const nativeIndent = Number.isFinite(inlineIndent) ? inlineIndent : indent - (previous?.indentShift ?? 0);
  const nativeWrapStart = border + nativePadding;
  const nativeFirst = first.left - left - (padding - nativePadding) - (indent - nativeIndent);
  const inset = Math.min(6, imageWidth / 8);
  const target = gutter + inset;
  const round = (offset: number) => Math.round(Math.max(0, offset) * 4) / 4;
  const ownLine = columns(whitespace) <= ownerIndent &&
    !row.querySelector(".cm-formatting-list, .cm-hmd-list-bullet");
  // Keep wrapped continuations on the same inset, and keep the native hanging indent of a caption's own lists.
  const paddingShift = round(target - (ownLine ? nativeWrapStart : Math.min(nativeWrapStart, nativeFirst)));
  const indentShift = ownLine ? round(target - nativeFirst) - paddingShift : 0;
  if (!paddingShift && !indentShift) return;
  return { padding: nativePadding + paddingShift, indent: nativeIndent + indentShift, paddingShift, indentShift };
}

function alignGuides(geometry: FigureGeometry, row?: HTMLElement): { guides: string; guideShift: number } {
  if (!geometry.guides.length) return { guides: "none", guideShift: 0 };
  const left = row?.getBoundingClientRect().left ?? 0;
  const native = row ? readIndentationGuides(row).map(guide => guide.left - left) : [];
  const guideShift = native.length ? native[0] - geometry.guides[0].offset : 0;
  const missing = geometry.guides.filter(guide => !native.some(offset => Math.abs(offset - guideShift - guide.offset) < 0.6));
  const guides = missing.map(({ offset, width, color }) => {
    return `linear-gradient(${color}, ${color}) ${offset}px 0 / ${width}px 100% no-repeat`;
  }).join(", ") || "none";
  return { guides, guideShift };
}

export class NativeCaptionLines {
  private math = new Set<HTMLElement>();
  private doc?: Text;
  private widths = new Map<number, FigureGeometry>();

  update(view: EditorView, captions: Iterable<CaptionSource>, images: ReadonlyMap<number, HTMLImageElement>, observed: Set<HTMLElement>): void {
    const { state } = view;
    const { doc, selection } = state;
    if (doc !== this.doc) {
      this.doc = doc;
      this.widths.clear();
    }
    const styles: RowStyle[] = [];
    const nextMath = new Set<HTMLElement>();
    const mathByLine = new Map<number, HTMLElement>();
    const rows = new Map<number, HTMLElement>();
    const previousStyles = new Map(state.field(nativeCaptionRows).styles.map(style => [style.from, style]));
    const parentLeft = view.contentDOM.getBoundingClientRect().left;
    const baseline = view.contentDOM.querySelector(".cm-line:not(.image-caption-peng--native-line, .image-caption-peng--native-empty, .image-caption-peng--native-spacer)");
    const contentLeft = baseline?.getBoundingClientRect().left ?? parentLeft;
    const base = Math.max(0, contentLeft - parentLeft - (Number.parseFloat(view.contentDOM.win.getComputedStyle(view.contentDOM).paddingLeft) || 0));
    const contentWidth = view.contentDOM.clientWidth;
    const hasNativeGuideMarkers = !!view.contentDOM.querySelector(".cm-indent");
    const firstVisible = doc.lineAt(view.viewport.from).number;
    const lastVisible = doc.lineAt(view.viewport.to).number;
    for (const row of view.contentDOM.querySelectorAll<HTMLElement>(":scope > :is(.cm-line, .math-block.cm-embed-block)")) {
      const number = doc.lineAt(view.posAtDOM(row)).number;
      (row.hasClass("cm-line") ? rows : mathByLine).set(number, row);
    }
    for (const caption of captions) {
      if (!caption.closed || !caption.image) continue;
      if (caption.endLine < firstVisible || caption.openLine > lastVisible) continue;
      let last = caption.endLine - 1;
      while (last > caption.openLine && !doc.line(last).text.trim()) last--;
      const image = images.get(caption.image.from);
      const picture = image?.getBoundingClientRect();
      const imageRow = image?.closest<HTMLElement>(".cm-line");
      if (image && picture?.width && picture.height && imageRow) {
        observed.add(image);
        const left = imageRow.getBoundingClientRect().left;
        this.widths.set(caption.image.from, {
          offset: picture.left - contentLeft,
          width: picture.width,
          font: imageRow.win.getComputedStyle(imageRow).fontSize,
          guides: readIndentationGuides(imageRow).map(({ left: guideLeft, width, color }) => ({ offset: guideLeft - left, width, color }))
        });
      }
      const cached = this.widths.get(caption.image.from);
      if (!cached) continue;
      // When the image is offscreen, its cached guides must not outlive the editor setting.
      const size = hasNativeGuideMarkers ? cached : { ...cached, guides: [] };
      const gutter = Math.max(0, size.offset);
      const width = Math.min(size.width, Math.max(0, contentWidth - gutter));
      if (!width) continue;
      for (let n = Math.max(firstVisible, caption.openLine); n <= Math.min(lastVisible, caption.endLine); n++) {
        const line = doc.line(n);
        const selected = selection.ranges.some(range => range.from <= line.to && range.to >= line.from);
        const math = mathByLine.get(n);
        if (math && n > caption.openLine && n <= last) {
          this.styleMath(math, gutter, width, base, alignGuides(size).guides);
          nextMath.add(math);
        }
        const boundary = n === caption.openLine || n === caption.endLine;
        const trailing = n > last && n !== caption.openLine + 1;
        const style = boundary || trailing || math ? (selected ? "" : hidden) :
          last === caption.openLine && !selected ? placeholder : !line.text.trim() && !selected ? spacer : body;
        if (!style) continue;
        const row = rows.get(n);
        const previous = row?.hasClass(aligned) ? previousStyles.get(line.from)?.alignment : undefined;
        const alignment = style === body && row ? alignText(view, row, line.from, line.text, caption.image.indent, gutter, width, previous) : undefined;
        const guides = style === hidden ? { guides: "none", guideShift: 0 } : alignGuides(size, row);
        styles.push({ from: line.from, style, gutter, width, base, border: row?.clientLeft ?? 0, font: size.font, ...guides, alignment });
      }
    }
    for (const row of this.math) if (!nextMath.has(row)) this.clearMath(row);
    this.math = nextMath;
    this.apply(view, styles);
  }

  private styleMath(row: HTMLElement, gutter: number, width: number, base: number, guides: string): void {
    if (!row.hasClass(mathClass)) row.addClass(body, mathClass);
    const properties = {
      [gutterProperty]: `${gutter}px`,
      [widthProperty]: `${width}px`,
      [baseProperty]: `${base}px`,
      [borderProperty]: `${row.clientLeft}px`,
      [guidesProperty]: guides
    };
    for (const [property, value] of Object.entries(properties)) {
      if (row.style.getPropertyValue(property) !== value) row.setCssProps({ [property]: value });
    }
    refreshMath(row);
  }

  private apply(view: EditorView, styles: RowStyle[]): void {
    const before = view.state.field(nativeCaptionRows).styles;
    if (before.length === styles.length && before.every((row, index) => {
      const next = styles[index];
      return row.from === next.from && row.style === next.style && rowAttributes(row) === rowAttributes(next);
    })) return;
    view.dispatch({ effects: setNativeRows.of(styles), annotations: Transaction.addToHistory.of(false) });
  }

  private clearMath(row: HTMLElement): void {
    row.removeClass(body, mathClass);
    for (const property of [gutterProperty, widthProperty, baseProperty, borderProperty, guidesProperty]) row.style.removeProperty(property);
    refreshMath(row);
  }

  clear(view?: EditorView): void {
    for (const row of this.math) this.clearMath(row);
    this.math.clear();
    this.widths.clear();
    if (view) this.apply(view, []);
  }
}
