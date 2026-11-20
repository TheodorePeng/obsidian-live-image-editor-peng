const previewRoot = ".markdown-preview-section";
const markdownEmbed = ".markdown-embed";

export interface MarkdownRenderScope {
  root: HTMLElement;
  embed: HTMLElement | null;
  canvasCard: HTMLElement | null;
}

export function markdownRenderScope(section: HTMLElement): MarkdownRenderScope | undefined {
  const root = section.closest<HTMLElement>(previewRoot);
  if (!root) return;
  const embed = root.closest<HTMLElement>(markdownEmbed);
  const editor = section.closest(".cm-editor");
  // A rendered note embed in a Canvas editor is still a separate, read-only preview.
  if (editor && embed?.closest(".cm-editor") !== editor) return;
  const host = editor ? root.ownerDocument.defaultView?.frameElement : root;
  const card = host?.closest<HTMLElement>(".canvas-node-content.markdown-embed");
  const canvasCard = card?.closest(".canvas-node") ? card : null;
  if (embed && !canvasCard) return;
  return { root, embed, canvasCard };
}

export function ownsMarkdownElement(scope: MarkdownRenderScope, element: Element): boolean {
  return element.closest(previewRoot) === scope.root && element.closest(markdownEmbed) === scope.embed;
}
