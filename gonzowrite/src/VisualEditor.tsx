import { useEffect, useRef, type CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { combineMarkdown, splitFrontmatter, visualSafetyWarnings } from "./markdown";
import { createEditorExtensions } from "./editorExtensions";

export function VisualEditor({ content, editorFont, codeFont, zoom, onChange, onReady }: {
  content: string;
  editorFont: string;
  codeFont: string;
  zoom: number;
  onChange: (content: string) => void;
  onReady: (editor: Editor | null) => void;
}) {
  const warnings = visualSafetyWarnings(content);
  const { frontmatter, body } = splitFrontmatter(content);
  const frontmatterRef = useRef(frontmatter);
  const onChangeRef = useRef(onChange);
  frontmatterRef.current = frontmatter;
  onChangeRef.current = onChange;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: createEditorExtensions(),
    content: warnings.length ? "" : body,
    contentType: "markdown",
    editorProps: { attributes: { class: "tiptap-editor", spellcheck: "true" } },
    onUpdate: ({ editor: activeEditor }) => {
      onChangeRef.current(combineMarkdown(frontmatterRef.current, activeEditor.getMarkdown()));
    },
  }, [warnings.join("|")]);

  useEffect(() => { onReady(editor); return () => onReady(null); }, [editor, onReady]);

  useEffect(() => {
    if (!editor || warnings.length) return;
    const current = combineMarkdown(frontmatter, editor.getMarkdown());
    if (current === content) return;
    editor.commands.setContent(body, { contentType: "markdown", emitUpdate: false });
  }, [body, content, editor, frontmatter, warnings.length]);

  if (warnings.length) {
    return <div className="unsafe-markdown">
      <strong>This document is protected from a lossy visual conversion.</strong>
      <p>Continue editing in Raw mode. Unsupported content detected: {warnings.join(", ")}.</p>
    </div>;
  }

  return <div className="visual-editor" style={{
    "--editor-font": editorFont,
    "--code-font": codeFont,
    fontSize: `${zoom}%`,
  } as CSSProperties}><EditorContent editor={editor} /></div>;
}
