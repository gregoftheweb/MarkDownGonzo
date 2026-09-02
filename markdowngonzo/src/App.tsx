import {
  lazy, Suspense, useEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import type { Editor } from "@tiptap/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  Bold, Braces, CheckSquare, ChevronDown, ChevronUp, Code2, Eye, FileDown, FilePlus2, FileText, FolderOpen,
  Heading1, Heading2, Heading3, ImagePlus, Italic, Link, List, ListOrdered,
  Menu, Minus, Moon, MoreHorizontal, PanelLeft, PanelLeftClose, PanelLeftOpen, Plus,
  Quote, Redo2, RotateCcw, Save, Search, Settings2, Strikethrough, Sun,
  Table2, Text, Underline, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { useDocuments } from "./useDocuments";
import type { Accent, DocumentTab, RawEditorHandle, Skin, ViewMode } from "./types";
import {
  chooseExportPath, errorDetails, exportDocument, exportFileName,
  importImageBytes, importImageFile, openLocalLink, type ExportFormat,
} from "./backend";
import { findTextMatches, matchesSelection, nextMatchIndex, type TextMatch } from "./findReplace";
import { visualSafetyWarnings } from "./markdown";
import { codeLanguages } from "./codeLanguages";
import logoUrl from "./assets/markdowngonzo-logo.png";

const RawEditor = lazy(() => import("./RawEditor").then((module) => ({ default: module.RawEditor })));
const VisualEditor = lazy(() => import("./VisualEditor").then((module) => ({ default: module.VisualEditor })));

function visualTextMatches(editor: Editor, query: string, caseSensitive: boolean): TextMatch[] {
  if (!query || editor.isDestroyed) return [];
  const matches: TextMatch[] = [];
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    for (const match of findTextMatches(node.text, query, caseSensitive)) {
      matches.push({ from: position + match.from, to: position + match.to });
    }
  });
  return matches;
}

const toolbarGroups = [
  [{ label: "Undo", icon: Undo2 }, { label: "Redo", icon: Redo2 }],
  [
    { label: "Bold", icon: Bold }, { label: "Italic", icon: Italic },
    { label: "Underline", icon: Underline }, { label: "Strikethrough", icon: Strikethrough },
  ],
  [{ label: "Heading 1", icon: Heading1 }, { label: "Heading 2", icon: Heading2 }, { label: "Heading 3", icon: Heading3 }],
  [
    { label: "Bullet list", icon: List }, { label: "Numbered list", icon: ListOrdered },
    { label: "Task list", icon: CheckSquare }, { label: "Quote", icon: Quote },
  ],
  [{ label: "Link", icon: Link }, { label: "Image", icon: ImagePlus }, { label: "Table", icon: Table2 }, { label: "Code", icon: Code2 }],
];

function IconButton({ label, children, active = false, disabled = false, expanded, controls, onClick }: {
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  onClick?: () => void;
}) {
  return (
    <button className={`icon-button${active ? " active" : ""}`} type="button" title={label}
      aria-label={label} aria-pressed={active || undefined} aria-expanded={expanded} aria-controls={controls}
      disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

type RibbonTab = "file" | "home" | "insert" | "table" | "view";

function RibbonButton({ label, icon: Icon, big = false, compact = false, active = false, disabled = false, onClick }: {
  label: string;
  icon: typeof Bold;
  big?: boolean;
  compact?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`wd-btn${big ? " wd-btn-lg" : ""}${compact ? " wd-btn-compact" : ""}${active ? " active" : ""}`}
      type="button" title={label} aria-label={label} aria-pressed={active || undefined} disabled={disabled} onClick={onClick}>
      <Icon size={big ? 22 : 16} aria-hidden />
      {!compact && <span>{label}</span>}
    </button>
  );
}

function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wd-group">
      <div className="wd-group-body">{children}</div>
      <div className="wd-group-label">{label}</div>
    </div>
  );
}

function noteDate(modifiedMs: number) {
  const date = new Date(modifiedMs);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function pathParent(path: string) {
  const parent = path.slice(0, Math.max(path.lastIndexOf("/"), 0));
  return parent.replace(/^\/home\/[^/]+/, "~") || "/";
}

function statusLabel(tab: DocumentTab | null) {
  if (!tab) return "Ready";
  return ({ saved: "Saved", dirty: "Unsaved", saving: "Saving…", error: "Save failed", external: "Changed outside MarkDownGonzo" })[tab.status];
}

function droppedImagePaths(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];
  const payload = dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain");
  return payload.split(/\r?\n/).flatMap((entry) => {
    const value = entry.trim();
    if (!value || value.startsWith("#")) return [];
    let path = value;
    if (/^file:\/\//i.test(value)) {
      try { path = decodeURIComponent(new URL(value).pathname); } catch { return []; }
    }
    return /^\/.*\.(png|jpe?g|gif|webp|svg)$/i.test(path) ? [path] : [];
  });
}

export default function App() {
  const docs = useDocuments();
  const {
    tabs, activeTab, setActiveId, recentNotes, setRecentNotes, config, configError, ready,
    sidebarOpen, setSidebarOpen, toolbarOpen, setToolbarOpen,
    newDocument, openDialog, openPaths, updateTab, saveTab, reloadTab, closeTab, reloadConfig, updateConfig,
  } = docs;
  const [dark, setDark] = useState(true);
  const [accent, setAccent] = useState<Accent>("tron");
  const [skin, setSkin] = useState<Skin>("studio");
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>("home");
  const [query, setQuery] = useState("");
  const [visualEditor, setVisualEditor] = useState<Editor | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [selectedFont, setSelectedFont] = useState("Roboto");
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [configNotice, setConfigNotice] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<ExportFormat | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const [warningDismissed, setWarningDismissed] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const rawEditorRef = useRef<RawEditorHandle>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const exportTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) setOverflowOpen(false);
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setExportMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOverflowOpen(false);
      setSettingsOpen(false);
      setExportMenuOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setDark(config.appearance.mode !== "light");
    if (["tron", "ferrari", "mclaren", "lambo"].includes(config.appearance.accent)) {
      setAccent(config.appearance.accent as Accent);
    }
    setSelectedFont(config.editor.font_family || "Roboto");
    setSkin(config.appearance.skin === "word" ? "word" : "studio");
  }, [config, ready]);

  const filteredNotes = useMemo(() => recentNotes.filter((note) =>
    `${note.name} ${note.path}`.toLowerCase().includes(query.toLowerCase())), [query, recentNotes]);

  useEffect(() => {
    if (!visualEditor) return;
    const refreshToolbar = () => setEditorRevision((revision) => revision + 1);
    visualEditor.on("selectionUpdate", refreshToolbar);
    visualEditor.on("transaction", refreshToolbar);
    return () => {
      visualEditor.off("selectionUpdate", refreshToolbar);
      visualEditor.off("transaction", refreshToolbar);
    };
  }, [visualEditor]);

  const setMode = (viewMode: ViewMode) => {
    if (activeTab) updateTab(activeTab.id, { viewMode });
  };

  useEffect(() => () => window.clearTimeout(exportTimer.current), []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const first = exportRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [exportMenuOpen]);

  const onExportMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(exportRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.findIndex((item) => item === document.activeElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    items[(current + offset + items.length) % items.length]?.focus();
  };

  const flashExport = (message: string, lingerMs = 7000) => {
    window.clearTimeout(exportTimer.current);
    setExportMessage(message);
    if (lingerMs > 0) exportTimer.current = window.setTimeout(() => setExportMessage(""), lingerMs);
  };

  const runExport = async (format: ExportFormat) => {
    setExportMenuOpen(false);
    if (!activeTab || exportBusy) return;
    const destination = await chooseExportPath(format, exportFileName(activeTab.name, format));
    if (!destination) return;
    setExportBusy(format);
    flashExport(`Exporting to ${format.toUpperCase()}…`, 0);
    try {
      // Export never touches the open document: it only reads the current text.
      const documentDir = activeTab.path ? activeTab.path.replace(/\/[^/]*$/, "") || "/" : null;
      const outcome = await exportDocument({
        markdown: activeTab.content,
        destination,
        documentDir,
        title: exportFileName(activeTab.name, format).replace(/\.[^.]+$/, ""),
      });
      flashExport(`Exported ${outcome.path.split("/").pop()}`);
    } catch (error) {
      const { kind, message } = errorDetails(error);
      flashExport(kind === "dependencyMissing" ? message : `Export failed: ${message}`, 12000);
    } finally {
      setExportBusy(null);
    }
  };

  const openFind = (withReplace = false) => {
    setFindOpen(true);
    setReplaceOpen(withReplace);
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
  };

  const currentMatches = useMemo(() => {
    if (!activeTab || !findQuery) return [];
    if (activeTab.viewMode === "raw") return findTextMatches(activeTab.content, findQuery, caseSensitive);
    return visualEditor && !visualEditor.isDestroyed ? visualTextMatches(visualEditor, findQuery, caseSensitive) : [];
  }, [activeTab, caseSensitive, editorRevision, findQuery, visualEditor]);

  const currentMatchIndex = (() => {
    if (!currentMatches.length || !activeTab) return -1;
    const selection = activeTab.viewMode === "raw"
      ? rawEditorRef.current?.getSelection()
      : visualEditor?.state.selection;
    if (!selection) return -1;
    return currentMatches.findIndex((match) => match.from === selection.from && match.to === selection.to);
  })();

  const navigateFind = (direction: 1 | -1) => {
    if (!activeTab || !currentMatches.length) return;
    const selection = activeTab.viewMode === "raw"
      ? rawEditorRef.current?.getSelection() ?? { from: 0, to: 0 }
      : visualEditor?.state.selection ?? { from: 0, to: 0 };
    const position = direction === 1 ? (selection.from === selection.to ? selection.from : selection.to) : selection.from;
    const index = nextMatchIndex(currentMatches, position, direction);
    const match = currentMatches[index];
    if (!match) return;
    if (activeTab.viewMode === "raw") rawEditorRef.current?.selectRange(match.from, match.to);
    else visualEditor?.chain().focus().setTextSelection(match).scrollIntoView().run();
    setEditorRevision((revision) => revision + 1);
  };

  const replaceCurrent = () => {
    if (!activeTab || !findQuery) return;
    if (activeTab.viewMode === "raw") {
      const selection = rawEditorRef.current?.getSelection();
      if (!selection || !matchesSelection(activeTab.content, findQuery, selection.from, selection.to, caseSensitive)) {
        navigateFind(1);
        return;
      }
      rawEditorRef.current?.replaceRange(selection.from, selection.to, replacement);
    } else if (visualEditor && !visualEditor.isDestroyed) {
      const { from, to } = visualEditor.state.selection;
      const selected = visualEditor.state.doc.textBetween(from, to);
      const equal = caseSensitive ? selected === findQuery : selected.toLocaleLowerCase() === findQuery.toLocaleLowerCase();
      if (!equal) {
        navigateFind(1);
        return;
      }
      visualEditor.chain().focus().insertContentAt({ from, to }, replacement).run();
    }
    window.setTimeout(() => {
      if (activeTab.viewMode === "raw") {
        const text = rawEditorRef.current?.getText() ?? "";
        const matches = findTextMatches(text, findQuery, caseSensitive);
        const selection = rawEditorRef.current?.getSelection() ?? { from: 0, to: 0 };
        const match = matches[nextMatchIndex(matches, selection.to, 1)];
        if (match) rawEditorRef.current?.selectRange(match.from, match.to);
      } else if (visualEditor && !visualEditor.isDestroyed) {
        const matches = visualTextMatches(visualEditor, findQuery, caseSensitive);
        const match = matches[nextMatchIndex(matches, visualEditor.state.selection.to, 1)];
        if (match) visualEditor.chain().focus().setTextSelection(match).scrollIntoView().run();
      }
      setEditorRevision((revision) => revision + 1);
    }, 0);
  };

  const replaceAll = () => {
    if (!activeTab || !currentMatches.length) return;
    if (activeTab.viewMode === "raw") {
      let content = activeTab.content;
      for (const match of [...currentMatches].reverse()) {
        content = `${content.slice(0, match.from)}${replacement}${content.slice(match.to)}`;
      }
      updateTab(activeTab.id, { content, status: "dirty", error: undefined });
    } else if (visualEditor && !visualEditor.isDestroyed) {
      visualEditor.chain().focus().command(({ tr }) => {
        for (const match of [...currentMatches].reverse()) tr.insertText(replacement, match.from, match.to);
        return true;
      }).run();
    }
  };

  const setZoom = (value: number) => {
    if (activeTab) updateTab(activeTab.id, { zoom: Math.min(180, Math.max(60, value)) });
  };

  const importImages = async (files: File[]) => {
    if (!activeTab || files.length === 0) return;
    const documentPath = activeTab.path ?? await saveTab(activeTab.id);
    if (!documentPath) return;
    try {
      let rawContent = activeTab.content;
      for (const file of files) {
        const extension = ({ "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" } as Record<string, string>)[file.type] ?? "png";
        const sourceName = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)
          ? file.name
          : `image-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        const image = await importImageBytes(documentPath, bytes, sourceName, config.images.directory);
        if (visualEditor && activeTab.viewMode === "visual") {
          visualEditor.chain().focus().setImage({ src: image.relativePath, alt: image.name }).run();
        } else {
          const separator = rawContent.endsWith("\n") || !rawContent ? "" : "\n";
          rawContent = `${rawContent}${separator}\n![${image.name}](${image.relativePath})\n`;
        }
      }
      if (!visualEditor || activeTab.viewMode !== "visual") {
        updateTab(activeTab.id, { content: rawContent, status: "dirty", error: undefined });
      }
    } catch (error) {
      window.alert(`Unable to import image: ${String(error)}`);
    }
  };

  const pasteImage = async (file: File) => {
    await importImages([file]);
  };

  const importImagePaths = async (sourcePaths: string[]) => {
    if (!activeTab || sourcePaths.length === 0) return;
    const documentPath = activeTab.path ?? await saveTab(activeTab.id);
    if (!documentPath) return;
    try {
      let rawContent = activeTab.content;
      for (const sourcePath of sourcePaths) {
        const image = await importImageFile(documentPath, sourcePath, config.images.directory);
        if (visualEditor && activeTab.viewMode === "visual") {
          visualEditor.chain().focus().setImage({ src: image.relativePath, alt: image.name }).run();
        } else {
          const separator = rawContent.endsWith("\n") || !rawContent ? "" : "\n";
          rawContent = `${rawContent}${separator}\n![${image.name}](${image.relativePath})\n`;
        }
      }
      if (!visualEditor || activeTab.viewMode !== "visual") {
        updateTab(activeTab.id, { content: rawContent, status: "dirty", error: undefined });
      }
    } catch (error) {
      window.alert(`Unable to import image: ${String(error)}`);
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const imagePaths = event.payload.paths.filter((path) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path));
      const markdownPaths = event.payload.paths.filter((path) => /\.(md|markdown)$/i.test(path));
      if (imagePaths.length) void importImagePaths(imagePaths);
      if (markdownPaths.length) void openPaths(markdownPaths);
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [activeTab, config.images.directory, openPaths, saveTab, updateTab, visualEditor]);

  useEffect(() => {
    const acceptDrop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = (event: DragEvent) => {
      const images = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name));
      const imagePaths = droppedImagePaths(event.dataTransfer);
      if (!images.length && !imagePaths.length) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (images.length) void importImages(images);
      else void importImagePaths(imagePaths);
    };
    window.addEventListener("dragover", acceptDrop, true);
    window.addEventListener("drop", handleDrop, true);
    return () => {
      window.removeEventListener("dragover", acceptDrop, true);
      window.removeEventListener("drop", handleDrop, true);
    };
  }, [activeTab, config.images.directory, visualEditor]);

  const runToolbarAction = (label: string) => {
    if (!visualEditor || visualEditor.isDestroyed) return;
    const chain = visualEditor.chain().focus();
    switch (label) {
      case "Undo": visualEditor.commands.undo(); break;
      case "Redo": visualEditor.commands.redo(); break;
      case "Bold": chain.toggleBold().run(); break;
      case "Italic": chain.toggleItalic().run(); break;
      case "Underline": chain.toggleUnderline().run(); break;
      case "Strikethrough": chain.toggleStrike().run(); break;
      case "Heading 1": chain.toggleHeading({ level: 1 }).run(); break;
      case "Heading 2": chain.toggleHeading({ level: 2 }).run(); break;
      case "Heading 3": chain.toggleHeading({ level: 3 }).run(); break;
      case "Bullet list": chain.toggleBulletList().run(); break;
      case "Numbered list": chain.toggleOrderedList().run(); break;
      case "Task list": chain.toggleTaskList().run(); break;
      case "Quote": chain.toggleBlockquote().run(); break;
      case "Code": chain.toggleCodeBlock().run(); break;
      case "Table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
      case "Link": {
        const current = visualEditor.getAttributes("link").href as string | undefined;
        const href = window.prompt("Link URL", current ?? "https://");
        if (href === null) break;
        if (!href) chain.unsetLink().run();
        else chain.extendMarkRange("link").setLink({ href }).run();
        break;
      }
      case "Image": {
        imageInputRef.current?.click();
        break;
      }
    }
  };

  const visualModeReady = Boolean(visualEditor && !visualEditor.isDestroyed && activeTab?.viewMode === "visual");
  const toolbarActionActive = (label: string) => {
    if (!visualEditor || !visualModeReady) return false;
    switch (label) {
      case "Bold": return visualEditor.isActive("bold");
      case "Italic": return visualEditor.isActive("italic");
      case "Underline": return visualEditor.isActive("underline");
      case "Strikethrough": return visualEditor.isActive("strike");
      case "Heading 1": return visualEditor.isActive("heading", { level: 1 });
      case "Heading 2": return visualEditor.isActive("heading", { level: 2 });
      case "Heading 3": return visualEditor.isActive("heading", { level: 3 });
      case "Bullet list": return visualEditor.isActive("bulletList");
      case "Numbered list": return visualEditor.isActive("orderedList");
      case "Task list": return visualEditor.isActive("taskList");
      case "Quote": return visualEditor.isActive("blockquote");
      case "Link": return visualEditor.isActive("link");
      case "Image": return visualEditor.isActive("image");
      case "Table": return visualEditor.isActive("table");
      case "Code": return visualEditor.isActive("codeBlock");
      default: return false;
    }
  };
  const toolbarActionDisabled = (label: string) => {
    if (!visualEditor || !visualModeReady) return true;
    return false;
  };
  const blockStyle = !visualEditor || !visualModeReady ? "paragraph"
    : visualEditor.isActive("heading", { level: 1 }) ? "heading-1"
      : visualEditor.isActive("heading", { level: 2 }) ? "heading-2"
        : visualEditor.isActive("heading", { level: 3 }) ? "heading-3"
          : visualEditor.isActive("codeBlock") ? "code-block"
            : "paragraph";
  const tableHasHeader = (() => {
    if (!visualEditor || !visualEditor.isActive("table")) return false;
    const { $from } = visualEditor.state.selection;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === "table") return node.firstChild?.firstChild?.type.name === "tableHeader";
    }
    return false;
  })();
  const codeLanguage = visualEditor?.isActive("codeBlock")
    ? String(visualEditor.getAttributes("codeBlock").language ?? "")
    : "";

  const setBlockStyle = (style: string) => {
    if (!visualEditor || visualEditor.isDestroyed || !visualModeReady) return;
    const chain = visualEditor.chain().focus();
    if (style === "heading-1") chain.setHeading({ level: 1 }).run();
    else if (style === "heading-2") chain.setHeading({ level: 2 }).run();
    else if (style === "heading-3") chain.setHeading({ level: 3 }).run();
    else if (style === "code-block") chain.setCodeBlock().run();
    else chain.setParagraph().run();
  };

  const setCodeLanguage = (language: string) => {
    if (!visualEditor || visualEditor.isDestroyed || !visualEditor.isActive("codeBlock")) return;
    visualEditor.chain().focus().updateAttributes("codeBlock", { language: language || null }).run();
  };

  const runTableAction = (action: string) => {
    if (!visualEditor || visualEditor.isDestroyed || !visualEditor.isActive("table")) return;
    const chain = visualEditor.chain().focus();
    switch (action) {
      case "row-before": chain.addRowBefore().run(); break;
      case "row-after": chain.addRowAfter().run(); break;
      case "delete-row": chain.deleteRow().run(); break;
      case "column-before": chain.addColumnBefore().run(); break;
      case "column-after": chain.addColumnAfter().run(); break;
      case "delete-column": chain.deleteColumn().run(); break;
      case "header": chain.toggleHeaderRow().run(); break;
      case "delete-table": chain.deleteTable().run(); break;
    }
  };

  const handleOpenLink = (href: string) => {
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      void openUrl(href);
      return;
    }
    if (href.startsWith("#") && visualEditor) {
      const wanted = decodeURIComponent(href.slice(1));
      visualEditor.state.doc.descendants((node, position) => {
        if (node.type.name !== "heading") return;
        const slug = node.textContent.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
        if (slug === wanted) visualEditor.chain().setTextSelection(position + 1).scrollIntoView().run();
      });
      return;
    }
    if (activeTab?.path) void openLocalLink(activeTab.path, decodeURIComponent(href));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        setFindOpen(false);
        if (activeTab?.viewMode === "raw") rawEditorRef.current?.focus();
        else visualEditor?.commands.focus();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "f" && !event.shiftKey) { event.preventDefault(); openFind(false); }
      else if (key === "h") { event.preventDefault(); openFind(true); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom((activeTab?.zoom ?? 100) + 10); }
      else if (event.key === "-") { event.preventDefault(); setZoom((activeTab?.zoom ?? 100) - 10); }
      else if (event.key === "0") { event.preventDefault(); setZoom(100); }
      else if (event.altKey && key === "m") { event.preventDefault(); setMode(activeTab?.viewMode === "raw" ? "visual" : "raw"); }
      else if (event.shiftKey && key === "s") { event.preventDefault(); setSidebarOpen((open) => !open); }
      else if (event.shiftKey && key === "t") { event.preventDefault(); setToolbarOpen((open) => !open); }
      else if (event.shiftKey && key === "f") { event.preventDefault(); setSidebarOpen(false); setToolbarOpen(false); }
      else if (event.shiftKey && key === "e") { event.preventDefault(); if (activeTab) setExportMenuOpen((open) => !open); }
      else if (key === "s") { event.preventDefault(); if (activeTab) void saveTab(activeTab.id); }
      else if (key === "o") { event.preventDefault(); void openDialog(); }
      else if (key === "n") { event.preventDefault(); newDocument(); }
      else if (key === "w" && activeTab) { event.preventDefault(); void closeTab(activeTab.id); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, closeTab, findOpen, newDocument, openDialog, saveTab, setSidebarOpen, setToolbarOpen, visualEditor]);

  const visualWarnings = useMemo(
    () => (activeTab && activeTab.viewMode === "visual" ? visualSafetyWarnings(activeTab.content) : []),
    [activeTab?.content, activeTab?.viewMode],
  );
  const warningKey = activeTab && visualWarnings.length ? `${activeTab.id}:${visualWarnings.join("|")}` : "";
  const showVisualWarning = Boolean(warningKey) && warningKey !== warningDismissed;

  const wordCount = activeTab?.content.trim() ? activeTab.content.trim().split(/\s+/).length : 0;
  const editorFont = selectedFont;
  const codeFont = config.editor.code_font_family || "Space Mono";
  const persistConfig = (next: typeof config) => {
    setConfigNotice("");
    void updateConfig(next).then((saved) => setConfigNotice(saved ? "Settings saved" : "Unable to save settings"));
  };
  const setSkinPreference = (next: Skin) => {
    setSkin(next);
    persistConfig({ ...config, appearance: { ...config.appearance, skin: next } });
  };
  const toggleDark = () => {
    const nextDark = !dark;
    setDark(nextDark);
    persistConfig({ ...config, appearance: { ...config.appearance, mode: nextDark ? "dark" : "light" } });
  };
  const chooseAccent = (color: Accent) => {
    setAccent(color);
    persistConfig({ ...config, appearance: { ...config.appearance, accent: color } });
  };

  const inTable = Boolean(visualModeReady && visualEditor?.isActive("table"));
  const inCodeBlock = Boolean(visualModeReady && visualEditor?.isActive("codeBlock"));
  const ribbonTabList: RibbonTab[] = ["file", "home", "insert", ...(inTable ? ["table" as const] : []), "view"];
  const activeRibbonTab: RibbonTab = ribbonTab === "table" && !inTable ? "home" : ribbonTab;
  const ribbonTabTitle: Record<RibbonTab, string> = {
    file: "File", home: "Home", insert: "Insert", table: "Table", view: "View",
  };
  const zoom = activeTab?.zoom ?? 100;

  const wordChrome = skin === "word" && (
    <>
      <header className="wd-titlebar">
        <div className="wd-qat">
          <span className="wd-qat-mark"><img src={logoUrl} alt="" /></span>
          <button type="button" title="Save" aria-label="Save" disabled={!activeTab}
            onClick={() => activeTab && void saveTab(activeTab.id)}><Save size={14} /></button>
          <button type="button" title="Undo" aria-label="Undo" disabled={!visualModeReady}
            onClick={() => runToolbarAction("Undo")}><Undo2 size={14} /></button>
          <button type="button" title="Redo" aria-label="Redo" disabled={!visualModeReady}
            onClick={() => runToolbarAction("Redo")}><Redo2 size={14} /></button>
        </div>
        <div className="wd-title">{activeTab ? `${activeTab.name} — MarkDownGonzo` : "MarkDownGonzo"}</div>
        <div className="wd-window-actions">
          <button type="button" title="Settings" aria-label="Settings" aria-expanded={settingsOpen}
            aria-controls="settings-panel" className={settingsOpen ? "active" : ""}
            onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={15} /></button>
        </div>
      </header>

      <div className="wd-tabstrip" role="tablist" aria-label="Ribbon">
        {ribbonTabList.map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={activeRibbonTab === tab}
            className={`wd-tab${activeRibbonTab === tab ? " active" : ""}${tab === "table" ? " wd-tab-context" : ""}`}
            onClick={() => { setRibbonTab(tab); setToolbarOpen(true); }}
            onDoubleClick={() => setToolbarOpen((open) => !open)}>
            {ribbonTabTitle[tab]}
          </button>
        ))}
        <span className="wd-tabstrip-spacer" />
        <button type="button" className="wd-ribbon-toggle" title={toolbarOpen ? "Collapse the ribbon" : "Expand the ribbon"}
          aria-label={toolbarOpen ? "Collapse the ribbon" : "Expand the ribbon"}
          onClick={() => setToolbarOpen((open) => !open)}>
          {toolbarOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {toolbarOpen && <div className="wd-ribbon" role="tabpanel" aria-label={`${ribbonTabTitle[activeRibbonTab]} ribbon`}>
        {activeRibbonTab === "file" && <>
          <RibbonGroup label="File">
            <div className="wd-row">
              <RibbonButton label="New" icon={FilePlus2} big onClick={() => newDocument()} />
              <RibbonButton label="Open" icon={FolderOpen} big onClick={() => void openDialog()} />
              <RibbonButton label="Save" icon={Save} big disabled={!activeTab}
                onClick={() => activeTab && void saveTab(activeTab.id)} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Export">
            <div className="wd-row">
              <RibbonButton label="PDF" icon={FileDown} big disabled={!activeTab || exportBusy !== null}
                onClick={() => void runExport("pdf")} />
              <RibbonButton label="ODT" icon={FileText} big disabled={!activeTab || exportBusy !== null}
                onClick={() => void runExport("odt")} />
            </div>
          </RibbonGroup>
        </>}

        {activeRibbonTab === "home" && <>
          <RibbonGroup label="Undo">
            <div className="wd-row">
              <RibbonButton label="Undo" icon={Undo2} compact disabled={!visualModeReady} onClick={() => runToolbarAction("Undo")} />
              <RibbonButton label="Redo" icon={Redo2} compact disabled={!visualModeReady} onClick={() => runToolbarAction("Redo")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Font">
            <div className="wd-row">
              <label className="wd-select wd-select-wide">
                <span className="sr-only">Document font</span>
                <select value={editorFont} onChange={(event) => {
                  setSelectedFont(event.target.value);
                  persistConfig({ ...config, editor: { ...config.editor, font_family: event.target.value } });
                }}>
                  {config.fonts.families.map((font) => (
                    <option value={font} key={font}>{font === "NovaMono" ? "Nova Mono" : font}</option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
            <div className="wd-row">
              <RibbonButton label="Bold" icon={Bold} compact active={toolbarActionActive("Bold")}
                disabled={toolbarActionDisabled("Bold")} onClick={() => runToolbarAction("Bold")} />
              <RibbonButton label="Italic" icon={Italic} compact active={toolbarActionActive("Italic")}
                disabled={toolbarActionDisabled("Italic")} onClick={() => runToolbarAction("Italic")} />
              <RibbonButton label="Underline" icon={Underline} compact active={toolbarActionActive("Underline")}
                disabled={toolbarActionDisabled("Underline")} onClick={() => runToolbarAction("Underline")} />
              <RibbonButton label="Strikethrough" icon={Strikethrough} compact active={toolbarActionActive("Strikethrough")}
                disabled={toolbarActionDisabled("Strikethrough")} onClick={() => runToolbarAction("Strikethrough")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Paragraph">
            <div className="wd-row">
              <RibbonButton label="Bullets" icon={List} compact active={toolbarActionActive("Bullet list")}
                disabled={toolbarActionDisabled("Bullet list")} onClick={() => runToolbarAction("Bullet list")} />
              <RibbonButton label="Numbering" icon={ListOrdered} compact active={toolbarActionActive("Numbered list")}
                disabled={toolbarActionDisabled("Numbered list")} onClick={() => runToolbarAction("Numbered list")} />
              <RibbonButton label="Task list" icon={CheckSquare} compact active={toolbarActionActive("Task list")}
                disabled={toolbarActionDisabled("Task list")} onClick={() => runToolbarAction("Task list")} />
              <RibbonButton label="Quote" icon={Quote} compact active={toolbarActionActive("Quote")}
                disabled={toolbarActionDisabled("Quote")} onClick={() => runToolbarAction("Quote")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Styles">
            <div className="wd-styles">
              <button className={`wd-style${blockStyle === "paragraph" ? " active" : ""}`} type="button"
                disabled={!visualModeReady} onClick={() => setBlockStyle("paragraph")}>
                <span className="wd-style-a">Normal</span></button>
              <button className={`wd-style${blockStyle === "heading-1" ? " active" : ""}`} type="button"
                disabled={!visualModeReady} onClick={() => setBlockStyle("heading-1")}>
                <span className="wd-style-h1">Heading 1</span></button>
              <button className={`wd-style${blockStyle === "heading-2" ? " active" : ""}`} type="button"
                disabled={!visualModeReady} onClick={() => setBlockStyle("heading-2")}>
                <span className="wd-style-h2">Heading 2</span></button>
              <button className={`wd-style${blockStyle === "heading-3" ? " active" : ""}`} type="button"
                disabled={!visualModeReady} onClick={() => setBlockStyle("heading-3")}>
                <span className="wd-style-h3">Heading 3</span></button>
              <button className={`wd-style${blockStyle === "code-block" ? " active" : ""}`} type="button"
                disabled={!visualModeReady} onClick={() => setBlockStyle("code-block")}>
                <span className="wd-style-code">Code Block</span></button>
            </div>
          </RibbonGroup>
          <RibbonGroup label="Editing">
            <div className="wd-row">
              <RibbonButton label="Find" icon={Search} big disabled={!activeTab} onClick={() => openFind(false)} />
              <RibbonButton label="Replace" icon={Text} big disabled={!activeTab} onClick={() => openFind(true)} />
            </div>
          </RibbonGroup>
        </>}

        {activeRibbonTab === "insert" && <>
          <RibbonGroup label="Tables">
            <div className="wd-row">
              <RibbonButton label="Table" icon={Table2} big active={toolbarActionActive("Table")}
                disabled={toolbarActionDisabled("Table")} onClick={() => runToolbarAction("Table")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Illustrations">
            <div className="wd-row">
              <RibbonButton label="Pictures" icon={ImagePlus} big disabled={!activeTab}
                onClick={() => runToolbarAction("Image")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Links">
            <div className="wd-row">
              <RibbonButton label="Link" icon={Link} big active={toolbarActionActive("Link")}
                disabled={toolbarActionDisabled("Link")} onClick={() => runToolbarAction("Link")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Code">
            <div className="wd-row">
              <RibbonButton label="Code Block" icon={Code2} big active={toolbarActionActive("Code")}
                disabled={toolbarActionDisabled("Code")} onClick={() => runToolbarAction("Code")} />
            </div>
            {inCodeBlock && <label className="wd-select">
              <span className="sr-only">Code block language</span>
              <select value={codeLanguage} onChange={(event) => setCodeLanguage(event.target.value)}>
                {codeLanguages.map(([value, label]) => <option value={value} key={value || "auto"}>{label}</option>)}
              </select>
              <ChevronDown size={13} />
            </label>}
          </RibbonGroup>
        </>}

        {activeRibbonTab === "table" && <>
          <RibbonGroup label="Rows & Columns">
            <div className="wd-row">
              <RibbonButton label="Insert Above" icon={Plus} onClick={() => runTableAction("row-before")} />
              <RibbonButton label="Insert Below" icon={Plus} onClick={() => runTableAction("row-after")} />
              <RibbonButton label="Delete Row" icon={Minus} compact onClick={() => runTableAction("delete-row")} />
            </div>
            <div className="wd-row">
              <RibbonButton label="Insert Left" icon={Plus} onClick={() => runTableAction("column-before")} />
              <RibbonButton label="Insert Right" icon={Plus} onClick={() => runTableAction("column-after")} />
              <RibbonButton label="Delete Column" icon={Minus} compact onClick={() => runTableAction("delete-column")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Table">
            <div className="wd-row">
              <RibbonButton label="Header Row" icon={Table2} big active={tableHasHeader}
                onClick={() => runTableAction("header")} />
              <RibbonButton label="Delete Table" icon={X} big onClick={() => runTableAction("delete-table")} />
            </div>
          </RibbonGroup>
        </>}

        {activeRibbonTab === "view" && <>
          <RibbonGroup label="Views">
            <div className="wd-row">
              <RibbonButton label="Visual" icon={Eye} big active={activeTab?.viewMode === "visual"}
                disabled={!activeTab} onClick={() => setMode("visual")} />
              <RibbonButton label="Raw" icon={Braces} big active={activeTab?.viewMode === "raw"}
                disabled={!activeTab} onClick={() => setMode("raw")} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Zoom">
            <div className="wd-row">
              <RibbonButton label="Zoom Out" icon={ZoomOut} compact onClick={() => setZoom(zoom - 10)} />
              <button className="wd-zoom-level" type="button" title="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</button>
              <RibbonButton label="Zoom In" icon={ZoomIn} compact onClick={() => setZoom(zoom + 10)} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Show">
            <div className="wd-row">
              <RibbonButton label="Navigation Pane" icon={PanelLeft} active={sidebarOpen}
                onClick={() => setSidebarOpen((open) => !open)} />
            </div>
            <div className="wd-row">
              <RibbonButton label="Ribbon" icon={Menu} active={toolbarOpen}
                onClick={() => setToolbarOpen((open) => !open)} />
            </div>
          </RibbonGroup>
          <RibbonGroup label="Appearance">
            <div className="wd-row">
              <RibbonButton label={dark ? "Light Mode" : "Dark Mode"} icon={dark ? Sun : Moon} onClick={toggleDark} />
            </div>
            <div className="wd-row wd-accents" aria-label="Accent color">
              {(["tron", "ferrari", "mclaren", "lambo"] as Accent[]).map((color) => (
                <button key={color} className={`swatch ${color}${accent === color ? " selected" : ""}`}
                  type="button" title={`${color} accent`} aria-label={`${color} accent`}
                  aria-pressed={accent === color} onClick={() => chooseAccent(color)} />
              ))}
            </div>
          </RibbonGroup>
        </>}
      </div>}
    </>
  );

  return (
    <main className="app" data-theme={dark ? "dark" : "light"} data-accent={accent} data-skin={skin}
      style={{ "--editor-font": editorFont, "--code-font": codeFont } as CSSProperties}>
      <input ref={imageInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void importImages(files);
        }} />
      {wordChrome}
      {skin === "studio" && <header className="titlebar">
        <div className="brand"><div className="brand-mark"><img src={logoUrl} alt="" /></div><span>MarkDownGonzo</span></div>
        <div className="title-actions">
          {!toolbarOpen && <IconButton label="Show toolbar" onClick={() => setToolbarOpen(true)}><Menu size={17} /></IconButton>}
          <div className="theme-picker" aria-label="Accent color">
            {(["tron", "ferrari", "mclaren", "lambo"] as Accent[]).map((color) => (
              <button key={color} className={`swatch ${color}${accent === color ? " selected" : ""}`}
                type="button" title={`${color} accent`} aria-label={`${color} accent`} aria-pressed={accent === color} onClick={() => {
                  setAccent(color);
                  persistConfig({ ...config, appearance: { ...config.appearance, accent: color } });
                }} />
            ))}
          </div>
          <IconButton label={dark ? "Use light theme" : "Use dark theme"} onClick={() => {
            const nextDark = !dark;
            setDark(nextDark);
            persistConfig({ ...config, appearance: { ...config.appearance, mode: nextDark ? "dark" : "light" } });
          }}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <IconButton label="Settings" active={settingsOpen} expanded={settingsOpen} controls="settings-panel"
            onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={17} /></IconButton>
        </div>
      </header>}

      {settingsOpen && <section className="settings-panel" id="settings-panel" role="dialog" aria-modal="false" aria-labelledby="settings-title">
        <div className="settings-heading"><div><span className="eyebrow">Preferences</span><h2 id="settings-title">Settings</h2></div>
          <button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={16} /></button></div>
        <label className="settings-select"><span>Theme</span>
          <select value={skin} onChange={(event) => setSkinPreference(event.target.value === "word" ? "word" : "studio")}>
            <option value="studio">MarkDownGonzo</option>
            <option value="word">Word (ribbon)</option>
          </select></label>
        <label><span>Spellcheck</span><input type="checkbox" checked={config.editor.spellcheck}
          onChange={(event) => persistConfig({ ...config, editor: { ...config.editor, spellcheck: event.target.checked } })} /></label>
        <label><span>Autosave</span><input type="checkbox" checked={config.autosave.enabled}
          onChange={(event) => persistConfig({ ...config, autosave: { ...config.autosave, enabled: event.target.checked } })} /></label>
        <label><span>Load remote images</span><input type="checkbox" checked={config.images.load_remote}
          onChange={(event) => persistConfig({ ...config, images: { ...config.images, load_remote: event.target.checked } })} /></label>
        <button className="reload-config" type="button" onClick={() => {
          setConfigNotice("");
          void reloadConfig().then((loaded) => setConfigNotice(loaded ? "Configuration reloaded" : "Unable to reload configuration"));
        }}><RotateCcw size={14} /> Reload Configuration</button>
        {(configError || configNotice) && <p className={configError ? "settings-error" : "settings-notice"} role="status">{configError || configNotice}</p>}
        <small>Changes are stored in ~/.config/markdowngonzo/config.toml</small>
      </section>}

      <section className={`workspace${sidebarOpen ? "" : " sidebar-hidden"}`}>
        {sidebarOpen && <aside className="sidebar">
          <div className="sidebar-heading">
            <div><span className="eyebrow">Your writing</span><h2>Recent notes</h2></div>
            <IconButton label="Collapse notes" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={18} /></IconButton>
          </div>
          <label className="search-box"><Search size={16} /><input type="search" placeholder="Search recent notes"
            value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="sidebar-buttons">
            <button type="button" onClick={() => newDocument()}><FilePlus2 size={16} /> New note</button>
            <button type="button" onClick={() => void openDialog()}><FolderOpen size={16} /> Open file</button>
          </div>
          <nav className="note-list" aria-label="Recent notes">
            {filteredNotes.map((note) => <button className={`note-card${activeTab?.path === note.path ? " selected" : ""}`}
              type="button" key={note.path} onClick={() => void openPaths([note.path])}>
              <span className="note-icon">MD</span>
              <span className="note-copy"><strong>{note.name}</strong><small>{pathParent(note.path)}</small></span>
              <time>{noteDate(note.modifiedMs)}</time>
            </button>)}
            {ready && filteredNotes.length === 0 && <p className="empty-recents">No recent notes</p>}
          </nav>
          <button className="clear-recents" type="button" onClick={() => setRecentNotes([])}>Clear recent notes</button>
        </aside>}

        <section className="document-area">
          <div className="tab-row">
            {!sidebarOpen && <IconButton label="Show notes" onClick={() => setSidebarOpen(true)}><PanelLeftOpen size={18} /></IconButton>}
            <div className="tab-scroll" role="tablist" aria-label="Open documents">
            {tabs.map((tab) => <div className={`tab${tab.id === activeTab?.id ? " active-tab" : ""}`} key={tab.id}>
              <button className="tab-select" type="button" role="tab" tabIndex={tab.id === activeTab?.id ? 0 : -1}
                data-tab-id={tab.id}
                aria-selected={tab.id === activeTab?.id} onClick={() => setActiveId(tab.id)} onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const index = tabs.findIndex((item) => item.id === tab.id);
                  const offset = event.key === "ArrowRight" ? 1 : -1;
                  const next = tabs[(index + offset + tabs.length) % tabs.length];
                  if (!next) return;
                  setActiveId(next.id);
                  window.setTimeout(() => document.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${CSS.escape(next.id)}"]`)?.focus(), 0);
                }} title={tab.path ?? "Unsaved document"}>
                <span className={`tab-dot ${tab.status}`} />{tab.name}
              </button>
              <button type="button" aria-label={`Close ${tab.name}`} onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}><X size={14} /></button>
            </div>)}
            <IconButton label="New tab" onClick={() => newDocument()}><Plus size={17} /></IconButton>
            </div>
            <div className="tab-actions">
              <IconButton label="Find and replace" onClick={() => openFind(false)} disabled={!activeTab}><Search size={17} /></IconButton>
              <div className="export-control" ref={exportRef}>
                <IconButton label="Export" expanded={exportMenuOpen} controls="export-menu"
                  disabled={!activeTab || exportBusy !== null}
                  onClick={() => setExportMenuOpen((open) => !open)}><FileDown size={17} /></IconButton>
                {exportMenuOpen && <div className="overflow-menu export-menu" id="export-menu" role="menu"
                  aria-label="Export document" onKeyDown={onExportMenuKeyDown}>
                  <button type="button" role="menuitem" onClick={() => void runExport("pdf")}>Export to PDF…</button>
                  <button type="button" role="menuitem" onClick={() => void runExport("odt")}>Export to ODT…</button>
                </div>}
              </div>
              <IconButton label="Save" onClick={() => activeTab && void saveTab(activeTab.id)} disabled={!activeTab}><Save size={17} /></IconButton>
            </div>
          </div>

          {skin === "studio" && toolbarOpen && <div className="toolbar" role="toolbar" aria-label="Formatting">
            <label className="select-control font-select"><span className="sr-only">Document font</span>
              <select value={editorFont} onChange={(event) => {
                setSelectedFont(event.target.value);
                persistConfig({ ...config, editor: { ...config.editor, font_family: event.target.value } });
              }}>{config.fonts.families.map((font) => <option value={font} key={font}>{font === "NovaMono" ? "Nova Mono" : font}</option>)}</select><ChevronDown size={14} />
            </label>
            <label className="select-control style-select"><span className="sr-only">Text style</span>
              <select value={blockStyle} disabled={!visualModeReady} onChange={(event) => setBlockStyle(event.target.value)}>
                <option value="paragraph">Paragraph</option>
                <option value="heading-1">Heading 1</option>
                <option value="heading-2">Heading 2</option>
                <option value="heading-3">Heading 3</option>
                <option value="code-block">Code Block</option>
              </select><ChevronDown size={14} /></label>
            {toolbarGroups.map((group, groupIndex) => <div className={`tool-group${groupIndex >= 2 ? " overflow-candidate" : ""}`} key={groupIndex}>
              {group.map(({ label, icon: ToolIcon }) => <IconButton label={label} key={label}
                active={toolbarActionActive(label)} disabled={toolbarActionDisabled(label)}
                onClick={() => runToolbarAction(label)}><ToolIcon size={17} /></IconButton>)}
            </div>)}
            <div className="toolbar-overflow" ref={overflowRef}>
              <IconButton label="More formatting" active={overflowOpen} expanded={overflowOpen} controls="formatting-overflow"
                onClick={() => setOverflowOpen((open) => !open)}><MoreHorizontal size={18} /></IconButton>
              {overflowOpen && <div className="overflow-menu" id="formatting-overflow" role="menu" aria-label="More formatting options">
                {toolbarGroups.slice(2).flat().map(({ label, icon: ToolIcon }) => <button type="button" role="menuitem" key={label}
                  disabled={toolbarActionDisabled(label)} onClick={() => { runToolbarAction(label); setOverflowOpen(false); }}>
                  <ToolIcon size={15} /><span>{label}</span>
                </button>)}
              </div>}
            </div>
            {visualModeReady && visualEditor?.isActive("codeBlock") && <label className="select-control language-select">
              <span className="sr-only">Code block language</span>
              <select value={codeLanguage} title="Code block language" onChange={(event) => setCodeLanguage(event.target.value)}>
                {codeLanguages.map(([value, label]) => <option value={value} key={value || "auto"}>{label}</option>)}
              </select><ChevronDown size={14} />
            </label>}
            {visualModeReady && visualEditor?.isActive("table") && <div className="table-tools" role="group" aria-label="Table editing">
              <button type="button" title="Add row above" onClick={() => runTableAction("row-before")}>+ Row ↑</button>
              <button type="button" title="Add row below" onClick={() => runTableAction("row-after")}>+ Row ↓</button>
              <button type="button" title="Delete current row" onClick={() => runTableAction("delete-row")}>− Row</button>
              <button type="button" title="Add column before" onClick={() => runTableAction("column-before")}>+ Col ←</button>
              <button type="button" title="Add column after" onClick={() => runTableAction("column-after")}>+ Col →</button>
              <button type="button" title="Delete current column" onClick={() => runTableAction("delete-column")}>− Col</button>
              <button className={tableHasHeader ? "active" : ""} type="button"
                title="Toggle header row" aria-pressed={tableHasHeader}
                onClick={() => runTableAction("header")}>Header</button>
              <button className="danger" type="button" title="Delete table" onClick={() => runTableAction("delete-table")}>Delete</button>
            </div>}
            <div className="toolbar-spacer" />
            <div className="mode-switch" role="group" aria-label="Editor mode">
              <button className={activeTab?.viewMode === "visual" ? "active" : ""} type="button" onClick={() => setMode("visual")}>Visual</button>
              <button className={activeTab?.viewMode === "raw" ? "active" : ""} type="button" onClick={() => setMode("raw")}><Braces size={14} /> Raw</button>
            </div>
            <IconButton label="Hide toolbar" onClick={() => setToolbarOpen(false)}><Minus size={17} /></IconButton>
          </div>}

          {activeTab?.status === "external" && <div className="conflict-banner">
            <span><strong>File changed outside MarkDownGonzo.</strong> Reload it or overwrite it with your current version.</span>
            <button type="button" onClick={() => void reloadTab(activeTab.id)}><RotateCcw size={14} /> Reload</button>
            <button type="button" onClick={() => void saveTab(activeTab.id, true)}><Save size={14} /> Overwrite</button>
          </div>}
          {activeTab?.status === "error" && <div className="conflict-banner error-banner"><span>{activeTab.error ?? "The document could not be saved."}</span></div>}
          {exportMessage && <div className={`conflict-banner export-banner${exportBusy ? " export-busy" : ""}`}>
            <span>{exportMessage}</span>
            {!exportBusy && <button type="button" aria-label="Dismiss" onClick={() => { window.clearTimeout(exportTimer.current); setExportMessage(""); }}><X size={14} /></button>}
          </div>}

          {showVisualWarning && <div className="conflict-banner">
            <span><strong>Rendering with unsupported content.</strong> {visualWarnings.join(", ")} may be altered or lost if you edit and save in Visual mode — switch to Raw to edit it safely.</span>
            <button type="button" onClick={() => setMode("raw")}><Braces size={14} /> Raw</button>
            <button type="button" aria-label="Dismiss" onClick={() => setWarningDismissed(warningKey)}><X size={14} /></button>
          </div>}

          {findOpen && activeTab && <div className="find-panel" role="search" aria-label="Find and replace">
            <div className="find-row">
              <Search size={15} />
              <input ref={findInputRef} type="text" value={findQuery} placeholder="Find"
                aria-label="Find text" onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); navigateFind(event.shiftKey ? -1 : 1); }
                }} />
              <span className="find-count" aria-live="polite">
                {findQuery ? (currentMatches.length ? `${currentMatchIndex < 0 ? "–" : currentMatchIndex + 1} of ${currentMatches.length}` : "No results") : ""}
              </span>
              <button className={`find-case${caseSensitive ? " active" : ""}`} type="button" title="Match case"
                aria-label="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((value) => !value)}>Aa</button>
              <button type="button" title="Previous match" aria-label="Previous match" disabled={!currentMatches.length}
                onClick={() => navigateFind(-1)}><ChevronDown className="find-up" size={16} /></button>
              <button type="button" title="Next match" aria-label="Next match" disabled={!currentMatches.length}
                onClick={() => navigateFind(1)}><ChevronDown size={16} /></button>
              <button className="find-replace-toggle" type="button" onClick={() => setReplaceOpen((open) => !open)}>
                {replaceOpen ? "Hide replace" : "Replace"}
              </button>
              <button type="button" title="Close" aria-label="Close find and replace" onClick={() => setFindOpen(false)}><X size={16} /></button>
            </div>
            {replaceOpen && <div className="find-row replace-row">
              <span className="replace-spacer" />
              <input type="text" value={replacement} placeholder="Replace with" aria-label="Replacement text"
                onChange={(event) => setReplacement(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); replaceCurrent(); } }} />
              <button className="text-button" type="button" disabled={!findQuery} onClick={replaceCurrent}>Replace</button>
              <button className="text-button" type="button" disabled={!currentMatches.length} onClick={replaceAll}>Replace all</button>
            </div>}
          </div>}

          <div className="editor-viewport">
            {!activeTab ? <div className="welcome-empty"><div className="brand-mark"><img src={logoUrl} alt="" /></div><h1>Start writing</h1>
              <p>Create a new Markdown document or open one from disk.</p><div><button onClick={() => newDocument()}>New note</button><button onClick={() => void openDialog()}>Open file</button></div></div>
            : <Suspense fallback={<div className="editor-loading">Preparing editor…</div>}>
              {activeTab.viewMode === "raw" ? <RawEditor ref={rawEditorRef} content={activeTab.content} dark={dark} codeFont={codeFont} zoom={activeTab.zoom} spellcheck={config.editor.spellcheck}
                onChange={(content) => updateTab(activeTab.id, { content, status: "dirty", error: undefined })} />
              : <VisualEditor content={activeTab.content} documentPath={activeTab.path} loadRemote={config.images.load_remote}
                editorFont={editorFont} codeFont={codeFont} zoom={activeTab.zoom} spellcheck={config.editor.spellcheck}
                onReady={setVisualEditor} onOpenLink={handleOpenLink}
                onPasteImage={(file) => void pasteImage(file)}
                onChange={(content) => updateTab(activeTab.id, { content, status: "dirty", error: undefined })} />}
            </Suspense>}
          </div>

          <footer className="statusbar">
            <span className={`save-state ${activeTab?.status ?? "saved"}`}><span /> {statusLabel(activeTab)}</span>
            <span>GitHub Markdown</span><span className="status-spacer" /><span>{wordCount} words</span>
            <div className="zoom-control"><button type="button" onClick={() => setZoom((activeTab?.zoom ?? 100) - 10)} aria-label="Zoom out"><Minus size={14} /></button>
              <button type="button" onClick={() => setZoom(100)}>{activeTab?.zoom ?? 100}%</button>
              <button type="button" onClick={() => setZoom((activeTab?.zoom ?? 100) + 10)} aria-label="Zoom in"><Plus size={14} /></button></div>
            <span>{activeTab?.path ? pathParent(activeTab.path) : "Unsaved draft"}</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
