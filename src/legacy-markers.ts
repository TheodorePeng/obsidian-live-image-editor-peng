/**
 * Detects markers written by versions before 0.3. Those markers are no longer
 * rendered, so a note that still contains them silently loses its crops and
 * caption styling. This module only reads text: it never rewrites a note.
 */

export interface LegacyScan {
  crop: boolean;
  caption: boolean;
}

const cropMarker = /<!--\s*live-image-editor-peng:v\d+\b/;
const captionMarker = /<!--\s*image-caption:(?:start|end)\b/;
const fenceLine = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function scanLegacyMarkers(text: string): LegacyScan {
  let crop = false;
  let caption = false;
  let open: { character: string; length: number } | undefined;
  for (const line of text.split(/\r?\n/)) {
    const fence = fenceLine.exec(line);
    if (open) {
      if (fence && fence[1][0] === open.character && fence[1].length >= open.length && !fence[2].trim()) open = undefined;
      continue;
    }
    if (fence) {
      open = { character: fence[1][0], length: fence[1].length };
      continue;
    }
    const content = stripInlineCode(line);
    if (!crop && cropMarker.test(content)) crop = true;
    if (!caption && captionMarker.test(content)) caption = true;
    if (crop && caption) break;
  }
  return { crop, caption };
}

export function legacyNoticeText(found: LegacyScan): string {
  if (!found.crop && !found.caption) return "";
  const crop = "本笔记还保留 0.3 之前的裁剪标记，0.3 起不再渲染。笔记内容没有被修改或删除：对图片重新裁剪会生成新的图块，之后可在源码模式删除旧标记。";
  const caption = "本笔记还保留 0.3 之前的图注标记，0.3 起不再渲染，图注文字仍完整保存在笔记里。若要重新添加图注，请先在源码模式删除旧的 image-caption 标记块，否则文字会重复出现。";
  if (found.crop && found.caption) return `${crop}\n\n${caption}`;
  return found.crop ? crop : caption;
}

/** Drops inline code spans so a note that documents the old syntax does not trigger a notice. */
function stripInlineCode(line: string): string {
  let kept = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      kept += line[index];
      index++;
      continue;
    }
    let run = 0;
    while (line[index + run] === "`") run++;
    const close = closingRun(line, index + run, run);
    if (close === -1) {
      kept += line.slice(index);
      break;
    }
    index = close + run;
  }
  return kept;
}

function closingRun(line: string, from: number, length: number): number {
  let index = from;
  while (index < line.length) {
    if (line[index] !== "`") {
      index++;
      continue;
    }
    let run = 0;
    while (line[index + run] === "`") run++;
    if (run >= length) return index;
    index += run;
  }
  return -1;
}
