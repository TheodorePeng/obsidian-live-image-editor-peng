import type { App } from "obsidian";

export function isLocalImageTarget(target: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

export function resolveTarget(app: App, target: string, sourcePath: string): string | undefined {
  if (/^(https?:|data:)/i.test(target)) return target;
  const file = app.metadataCache.getFirstLinkpathDest(decodeLink(target.replace(/\\([()<> ])/g, "$1")), sourcePath);
  if (file) return app.vault.getResourcePath(file);
}

function decodeLink(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

export function sameImage(app: App, image: HTMLImageElement, source: { target: string }, path: string): boolean {
  const expected = resolveTarget(app, source.target, path);
  if (!expected || !URL.canParse(expected) || !URL.canParse(image.src)) return false;
  const lhs = new URL(expected);
  const rhs = new URL(image.src);
  if (lhs.protocol === "app:" && rhs.protocol === "app:") {
    return lhs.host === rhs.host && decodeLink(lhs.pathname) === decodeLink(rhs.pathname);
  }
  return lhs.href === rhs.href;
}
