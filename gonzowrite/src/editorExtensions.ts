import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import UnderlineExtension from "@tiptap/extension-underline";

const GitHubUnderline = UnderlineExtension.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
});

export function createEditorExtensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, underline: false }),
    GitHubUnderline,
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ allowBase64: false }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
}
