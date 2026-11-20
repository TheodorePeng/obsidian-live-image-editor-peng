import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { EditorView } from "@codemirror/view";
import { canvasTextEditor, isCanvasTextEditor } from "../src/canvas-text-editor";
import { markdownRenderScope, ownsMarkdownElement } from "../src/markdown-render-scope";

function textNode(editor: EditorView) {
  return {
    isEditing: true,
    text: "A Canvas card",
    child: { editMode: { cm: editor } },
    getData: () => ({ type: "text" })
  };
}

void test("binds only the editing Canvas text card that owns the CodeMirror instance", () => {
  const editor = {} as EditorView;
  const anotherEditor = {} as EditorView;
  const target = textNode(editor);
  const nodes = new Map([
    ["file", { ...target, getData: () => ({ type: "file" }) }],
    ["closed", { ...target, isEditing: false }],
    ["target", target],
    ["other", textNode(anotherEditor)]
  ]);
  const view = { canvas: { nodes } };
  const binding = canvasTextEditor([undefined, { canvas: {} }, view], editor);
  ok(binding);
  equal(binding.id, "target");
  equal(binding.node, target);
  equal(isCanvasTextEditor(binding, anotherEditor), false);

  nodes.set("second-owner", textNode(editor));
  equal(canvasTextEditor([view], editor), undefined);
  nodes.delete("second-owner");

  target.isEditing = false;
  equal(isCanvasTextEditor(binding, editor), false);
  target.isEditing = true;
  target.child.editMode.cm = anotherEditor;
  equal(isCanvasTextEditor(binding, editor), false);
  target.child.editMode.cm = editor;
  equal(isCanvasTextEditor(binding, editor), true);
  nodes.set("target", textNode(editor));
  equal(isCanvasTextEditor(binding, editor), false);
});

function element(classes: string, parent?: HTMLElement, frameElement?: HTMLElement): HTMLElement {
  const ownClasses = classes.split(" ");
  const node = {
    ownerDocument: { defaultView: { frameElement } },
    closest(selector: string): HTMLElement | null {
      const matches = selector.slice(1).split(".").every(name => ownClasses.includes(name));
      return matches ? node as unknown as HTMLElement : parent?.closest(selector) ?? null;
    }
  };
  return node as unknown as HTMLElement;
}

void test("keeps Canvas card previews, nested note previews, and adjacent cards separate", () => {
  const node = element("canvas-node");
  const card = element("canvas-node-content markdown-embed", node);
  const cardPreview = element("markdown-preview-section", card);
  const cardSection = element("el-p", cardPreview);
  const cardImage = element("image", cardSection);
  const embed = element("markdown-embed", cardSection);
  const embedPreview = element("markdown-preview-section", embed);
  const embedImage = element("image", embedPreview);
  const otherCard = element("canvas-node-content markdown-embed", element("canvas-node"));
  const otherImage = element("image", element("markdown-preview-section", otherCard));
  const cardScope = markdownRenderScope(cardSection);
  const embedScope = markdownRenderScope(embedImage);
  ok(cardScope && embedScope);
  equal(cardScope.canvasCard, card);
  equal(embedScope.canvasCard, card);
  equal(ownsMarkdownElement(cardScope, cardImage), true);
  equal(ownsMarkdownElement(cardScope, embedImage), false);
  equal(ownsMarkdownElement(cardScope, otherImage), false);
  equal(ownsMarkdownElement(embedScope, embedImage), true);
  equal(ownsMarkdownElement(embedScope, cardImage), false);
});

void test("allows read-only note previews inside a native Canvas editor iframe", () => {
  const card = element("canvas-node-content markdown-embed", element("canvas-node"));
  const frame = element("embed-iframe", card);
  const editor = element("cm-editor");
  const embed = element("markdown-embed", editor);
  const preview = element("markdown-preview-section", embed, frame);
  equal(markdownRenderScope(preview)?.canvasCard, card);
  equal(markdownRenderScope(element("markdown-preview-section", editor, frame)), undefined);
  equal(markdownRenderScope(element("markdown-preview-section", embed, element("embed-iframe"))), undefined);
});

void test("keeps standalone Reading View and excludes ordinary note embeds and editor widgets", () => {
  const preview = element("markdown-preview-section");
  equal(markdownRenderScope(preview)?.root, preview);
  const embed = element("markdown-embed", preview);
  equal(markdownRenderScope(element("markdown-preview-section", embed)), undefined);
  const editor = element("cm-editor");
  equal(markdownRenderScope(element("markdown-preview-section", editor)), undefined);
});
