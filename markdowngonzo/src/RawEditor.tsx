import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { RawEditorHandle } from "./types";

export const RawEditor = forwardRef<RawEditorHandle, {
  content: string;
  dark: boolean;
  codeFont: string;
  zoom: number;
  onChange: (content: string) => void;
}>(function RawEditor({ content, dark, codeFont, zoom, onChange }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    getText: () => view.current?.state.doc.toString() ?? "",
    getSelection: () => {
      const selection = view.current?.state.selection.main;
      return selection ? { from: selection.from, to: selection.to } : { from: 0, to: 0 };
    },
    selectRange: (from, to) => {
      const editor = view.current;
      if (!editor) return;
      const safeFrom = Math.max(0, Math.min(from, editor.state.doc.length));
      const safeTo = Math.max(safeFrom, Math.min(to, editor.state.doc.length));
      editor.dispatch({
        selection: { anchor: safeFrom, head: safeTo },
        effects: EditorView.scrollIntoView(safeFrom, { y: "center" }),
      });
      editor.focus();
    },
    replaceRange: (from, to, replacement) => {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch({
        changes: { from, to, insert: replacement },
        selection: { anchor: from + replacement.length },
      });
      editor.focus();
    },
  }), []);

  useEffect(() => {
    if (!host.current) return;
    const theme = EditorView.theme({
      "&": { height: "100%", backgroundColor: "transparent", fontSize: `${zoom}%` },
      ".cm-scroller": { fontFamily: codeFont, lineHeight: "1.75", padding: "30px 0" },
      ".cm-content": { padding: "0 36px" },
      ".cm-gutters": { paddingLeft: "8px", backgroundColor: "transparent", borderRight: "1px solid var(--border)" },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(var(--accent-rgb), .055)" },
      ".cm-cursor": { borderLeftColor: "var(--accent)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(var(--accent-rgb), .22) !important" },
    });
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          markdown(),
          ...(dark ? [oneDark] : []),
          theme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [codeFont, dark, zoom]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === content) return;
    syncing.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
    syncing.current = false;
  }, [content]);

  return <div className="raw-editor" ref={host} aria-label="Raw Markdown editor" />;
});
