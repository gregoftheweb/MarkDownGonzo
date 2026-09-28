import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { combineMarkdown, splitFrontmatter } from "./markdown";
import { createEditorExtensions } from "./editorExtensions";

// getMarkdown() walks the whole ProseMirror document, so calling it on every
// keystroke (the old onUpdate) made typing cost scale with document size.
// Debounce it instead, and flush immediately on blur - losing focus is what
// precedes every real transition away from this editor (switching tabs,
// switching to the raw view, hitting save), so it reliably carries the
// latest keystrokes into tab.content before any of those happen.
const SERIALIZE_DEBOUNCE_MS = 200;

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

  const pendingSerializeRef = useRef<number | null>(null);
  const cancelPendingSerialize = useCallback(() => {
    if (pendingSerializeRef.current !== null) {
      window.clearTimeout(pendingSerializeRef.current);
      pendingSerializeRef.current = null;
    }
  }, []);
  // Safe to call anytime the editor is still alive - bypasses the debounce
  // and emits the current markdown right now.
  const flushSerialize = useCallback((activeEditor: Editor) => {
    cancelPendingSerialize();
    if (activeEditor.isDestroyed) return;
    onChangeRef.current(combineMarkdown(frontmatterRef.current, activeEditor.getMarkdown()));
  }, [cancelPendingSerialize]);

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
      cancelPendingSerialize();
      pendingSerializeRef.current = window.setTimeout(() => {
        pendingSerializeRef.current = null;
        flushSerialize(activeEditor);
      }, SERIALIZE_DEBOUNCE_MS);
    },
    onBlur: ({ editor: activeEditor }) => flushSerialize(activeEditor),
  }, [documentPath, loadRemote, spellcheck]);

  useEffect(() => {
    onReady(editor && !editor.isDestroyed ? editor : null);
    return () => {
      onReady(null);
      // Best-effort only: onBlur is what actually carries the latest
      // keystrokes out in the transitions that matter (tab switch, raw-view
      // toggle, save). By the time this cleanup runs the editor is usually
      // already destroyed (tiptap tears it down before this effect's own
      // cleanup fires), so this just catches any other case cheaply.
      cancelPendingSerialize();
      if (editor && !editor.isDestroyed) {
        try {
          onChangeRef.current(combineMarkdown(frontmatterRef.current, editor.getMarkdown()));
        } catch {
          // Editor is mid-teardown; nothing more we can safely read from it.
        }
      }
    };
  }, [editor, onReady, cancelPendingSerialize]);

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
