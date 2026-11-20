import type { EditorView } from "@codemirror/view";

type EditMode = { cm?: EditorView };

interface CanvasNode {
  isEditing?: boolean;
  text?: string;
  getData?(): { type?: string };
  child?: { editMode?: EditMode; editable?: EditMode };
}

interface CanvasView {
  canvas?: { nodes?: Map<string, CanvasNode> };
}

export interface CanvasTextEditor {
  view: CanvasView;
  nodes: Map<string, CanvasNode>;
  id: string;
  node: CanvasNode;
}

function ownsEditor(node: CanvasNode, editor: EditorView): boolean {
  return node.isEditing === true && typeof node.text === "string" &&
    (node.child?.editMode?.cm === editor || node.child?.editable?.cm === editor) &&
    node.getData?.()?.type === "text";
}

export function canvasTextEditor(views: Iterable<unknown>, editor: EditorView): CanvasTextEditor | undefined {
  let match: CanvasTextEditor | undefined;
  for (const candidate of views) {
    const view = candidate as CanvasView | null;
    const nodes = view?.canvas?.nodes;
    if (!view || !(nodes instanceof Map)) continue;
    for (const [id, node] of nodes) {
      if (!node?.isEditing || !ownsEditor(node, editor)) continue;
      if (match) return;
      match = { view, nodes, id, node };
    }
  }
  return match;
}

export function isCanvasTextEditor(binding: CanvasTextEditor, editor: EditorView): boolean {
  return binding.view.canvas?.nodes === binding.nodes &&
    binding.nodes.get(binding.id) === binding.node && ownsEditor(binding.node, editor);
}
