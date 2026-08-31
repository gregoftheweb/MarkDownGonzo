import { useEffect, useRef, type CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { combineMarkdown, splitFrontmatter } from "./markdown";
import { createEditorExtensions } from "./editorExtensions";

export function VisualEditor({ content, documentPath, loadRemote, editorFont, codeFont, zoom, spellcheck, onChange, onReady, onOpenLink, onPasteImage }: {
  content: string;
  documentPath: string | null;
  loadRemote: boolean;
  editorFont: string;
  codeFont: string;
  zoom: number;
  spellcheck: boolean;
  onChange: (content: string) => void;
  onReady: (editor: Editor | null) => void;
  onOpenLink: (href: string) => void;
  onPasteImage: (file: File) => void;
}) {
  const { frontmatter, body } = splitFrontmatter(content);
  const frontmatterRef = useRef(frontmatter);
  const onChangeRef = useRef(onChange);
  const onOpenLinkRef = useRef(onOpenLink);
  const onPasteImageRef = useRef(onPasteImage);
  frontmatterRef.current = frontmatter;
  onChangeRef.current = onChange;
  onOpenLinkRef.current = onOpenLink;
  onPasteImageRef.current = onPasteImage;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: createEditorExtensions({ documentPath, loadRemote }),
    content: body,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "tiptap-editor", spellcheck: spellcheck ? "true" : "false" },
      handleClick: (_view, _position, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const target = event.target instanceof Element ? event.target.closest("a") : null;
        const href = target?.getAttribute("href");
        if (!href) return false;
        event.preventDefault();
        onOpenLinkRef.current(href);
        return true;
      },
      handlePaste: (_view, event) => {
        const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
        if (!image) return false;
        event.preventDefault();
        onPasteImageRef.current(image);
        return true;
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      onChangeRef.current(combineMarkdown(frontmatterRef.current, activeEditor.getMarkdown()));
    },
  }, [documentPath, loadRemote, spellcheck]);

  useEffect(() => {
    onReady(editor && !editor.isDestroyed ? editor : null);
    return () => onReady(null);
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = combineMarkdown(frontmatter, editor.getMarkdown());
    if (current === content) return;
    if (editor.isDestroyed) return;
    editor.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
  }, [body, content, editor, frontmatter]);

  return <div className="visual-editor" style={{
    "--editor-font": editorFont,
    "--code-font": codeFont,
    fontSize: `${zoom}%`,
  } as CSSProperties}><EditorContent editor={editor} /></div>;
}
