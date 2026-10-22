import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import UnderlineExtension from "@tiptap/extension-underline";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { ImageNodeView } from "./ImageNodeView";

const lowlight = createLowlight(common);

const GitHubUnderline = UnderlineExtension.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
});

interface GonzoImageOptions extends ImageOptions {
  documentPath: string | null;
  loadRemote: boolean;
}

const GonzoImage = Image.extend<GonzoImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      documentPath: null as string | null,
      loadRemote: true,
    } as GonzoImageOptions;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
  // Pure `![alt](src)` unless the image has been resized (width attr set) -
  // only then does this drop to an inline <img> tag, since GFM's bracket
  // syntax has no way to carry a width. Keeps every unresized image's
  // markdown byte-for-byte identical to plain GFM.
  renderMarkdown(node) {
    const src = String(node.attrs?.src ?? "");
    const alt = String(node.attrs?.alt ?? "");
    const title = node.attrs?.title ? String(node.attrs.title) : "";
    const width = node.attrs?.width;

    if (width) {
      const escapedSrc = String(src).replace(/"/g, "&quot;");
      const escapedAlt = String(alt).replace(/"/g, "&quot;");
      return `<img src="${escapedSrc}" alt="${escapedAlt}" width="${String(width)}">`;
    }

    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
});

export function createEditorExtensions(options: { documentPath?: string | null; loadRemote?: boolean } = {}) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, underline: false, codeBlock: false }),
    CodeBlockLowlight.configure({ lowlight, enableTabIndentation: true, tabSize: 2 }),
    GitHubUnderline,
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    GonzoImage.configure({
      allowBase64: false,
      documentPath: options.documentPath ?? null,
      loadRemote: options.loadRemote ?? true,
    }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
}
