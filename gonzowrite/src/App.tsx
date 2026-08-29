import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bold, Braces, CheckSquare, ChevronDown, Code2, FilePlus2, FolderOpen,
  Heading1, Heading2, Heading3, ImagePlus, Italic, Link, List, ListOrdered,
  Menu, Minus, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus,
  Quote, Redo2, RotateCcw, Save, Search, Settings2, Strikethrough, Sun,
  Table2, Underline, Undo2, X,
} from "lucide-react";
import { useDocuments } from "./useDocuments";
import type { Accent, DocumentTab, ViewMode } from "./types";
import { chooseImages, importImageBytes, importImageFile, openLocalLink } from "./backend";
import logoUrl from "./assets/gonzowrite-logo.png";

const RawEditor = lazy(() => import("./RawEditor").then((module) => ({ default: module.RawEditor })));
const VisualEditor = lazy(() => import("./VisualEditor").then((module) => ({ default: module.VisualEditor })));

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

function IconButton({ label, children, active = false, disabled = false, onClick }: {
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`icon-button${active ? " active" : ""}`} type="button" title={label}
      aria-label={label} aria-pressed={active || undefined} disabled={disabled} onClick={onClick}>
      {children}
    </button>
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
  return ({ saved: "Saved", dirty: "Unsaved", saving: "Saving…", error: "Save failed", external: "Changed outside GonzoWrite" })[tab.status];
}

export default function App() {
  const docs = useDocuments();
  const {
    tabs, activeTab, setActiveId, recentNotes, setRecentNotes, config, ready,
    sidebarOpen, setSidebarOpen, toolbarOpen, setToolbarOpen,
    droppedImages, clearDroppedImages,
    newDocument, openDialog, openPaths, updateTab, saveTab, reloadTab, closeTab,
  } = docs;
  const [dark, setDark] = useState(true);
  const [accent, setAccent] = useState<Accent>("tron");
  const [query, setQuery] = useState("");
  const [visualEditor, setVisualEditor] = useState<Editor | null>(null);
  const [selectedFont, setSelectedFont] = useState("Roboto");

  useEffect(() => {
    if (!ready) return;
    setDark(config.appearance.mode !== "light");
    if (["tron", "ferrari", "mclaren", "lambo"].includes(config.appearance.accent)) {
      setAccent(config.appearance.accent as Accent);
    }
    setSelectedFont(config.editor.font_family || "Roboto");
  }, [config, ready]);

  const filteredNotes = useMemo(() => recentNotes.filter((note) =>
    `${note.name} ${note.path}`.toLowerCase().includes(query.toLowerCase())), [query, recentNotes]);

  const setMode = (viewMode: ViewMode) => {
    if (activeTab) updateTab(activeTab.id, { viewMode });
  };

  const setZoom = (value: number) => {
    if (activeTab) updateTab(activeTab.id, { zoom: Math.min(180, Math.max(60, value)) });
  };

  const insertImportedImages = async (sourcePaths: string[]) => {
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

  const pasteImage = async (file: File) => {
    if (!activeTab) return;
    const documentPath = activeTab.path ?? await saveTab(activeTab.id);
    if (!documentPath) return;
    const extension = ({ "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" } as Record<string, string>)[file.type] ?? "png";
    const sourceName = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)
      ? file.name
      : `pasted-image-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const image = await importImageBytes(documentPath, bytes, sourceName, config.images.directory);
      visualEditor?.chain().focus().setImage({ src: image.relativePath, alt: image.name }).run();
    } catch (error) {
      window.alert(`Unable to paste image: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (!droppedImages.length) return;
    void insertImportedImages(droppedImages).finally(clearDroppedImages);
  }, [droppedImages]);

  const runToolbarAction = (label: string) => {
    if (!visualEditor) return;
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
        void chooseImages().then((paths) => insertImportedImages(paths));
        break;
      }
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
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom((activeTab?.zoom ?? 100) + 10); }
      else if (event.key === "-") { event.preventDefault(); setZoom((activeTab?.zoom ?? 100) - 10); }
      else if (event.key === "0") { event.preventDefault(); setZoom(100); }
      else if (event.altKey && key === "m") { event.preventDefault(); setMode(activeTab?.viewMode === "raw" ? "visual" : "raw"); }
      else if (event.shiftKey && key === "s") { event.preventDefault(); setSidebarOpen((open) => !open); }
      else if (event.shiftKey && key === "t") { event.preventDefault(); setToolbarOpen((open) => !open); }
      else if (event.shiftKey && key === "f") { event.preventDefault(); setSidebarOpen(false); setToolbarOpen(false); }
      else if (key === "s") { event.preventDefault(); if (activeTab) void saveTab(activeTab.id); }
      else if (key === "o") { event.preventDefault(); void openDialog(); }
      else if (key === "n") { event.preventDefault(); newDocument(); }
      else if (key === "w" && activeTab) { event.preventDefault(); void closeTab(activeTab.id); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, closeTab, newDocument, openDialog, saveTab, setSidebarOpen, setToolbarOpen]);

  const wordCount = activeTab?.content.trim() ? activeTab.content.trim().split(/\s+/).length : 0;
  const editorFont = selectedFont;
  const codeFont = config.editor.code_font_family || "Space Mono";

  return (
    <main className="app" data-theme={dark ? "dark" : "light"} data-accent={accent}
      style={{ "--editor-font": editorFont, "--code-font": codeFont } as CSSProperties}>
      <header className="titlebar">
        <div className="brand"><div className="brand-mark"><img src={logoUrl} alt="" /></div><span>GonzoWrite</span></div>
        <div className="title-actions">
          {!toolbarOpen && <IconButton label="Show toolbar" onClick={() => setToolbarOpen(true)}><Menu size={17} /></IconButton>}
          <div className="theme-picker" aria-label="Accent color">
            {(["tron", "ferrari", "mclaren", "lambo"] as Accent[]).map((color) => (
              <button key={color} className={`swatch ${color}${accent === color ? " selected" : ""}`}
                type="button" title={`${color} accent`} aria-label={`${color} accent`} onClick={() => setAccent(color)} />
            ))}
          </div>
          <IconButton label={dark ? "Use light theme" : "Use dark theme"} onClick={() => setDark((value) => !value)}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <IconButton label="Settings"><Settings2 size={17} /></IconButton>
        </div>
      </header>

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
            {tabs.map((tab) => <div className={`tab${tab.id === activeTab?.id ? " active-tab" : ""}`} key={tab.id}
              onClick={() => setActiveId(tab.id)} title={tab.path ?? "Unsaved document"}>
              <span className={`tab-dot ${tab.status}`} />{tab.name}
              <button type="button" aria-label={`Close ${tab.name}`} onClick={(event) => { event.stopPropagation(); void closeTab(tab.id); }}><X size={14} /></button>
            </div>)}
            <IconButton label="New tab" onClick={() => newDocument()}><Plus size={17} /></IconButton>
            <div className="tab-spacer" />
            <IconButton label="Save" onClick={() => activeTab && void saveTab(activeTab.id)} disabled={!activeTab}><Save size={17} /></IconButton>
            <IconButton label="More tab actions"><MoreHorizontal size={18} /></IconButton>
          </div>

          {toolbarOpen && <div className="toolbar" role="toolbar" aria-label="Formatting">
            <label className="select-control font-select"><span className="sr-only">Document font</span>
              <select value={editorFont} onChange={(event) => setSelectedFont(event.target.value)}>{config.fonts.families.map((font) => <option value={font} key={font}>{font}</option>)}</select><ChevronDown size={14} />
            </label>
            <label className="select-control style-select"><span className="sr-only">Text style</span><select defaultValue="paragraph" disabled>
              <option value="paragraph">Paragraph</option></select><ChevronDown size={14} /></label>
            {toolbarGroups.map((group, groupIndex) => <div className="tool-group" key={groupIndex}>
              {group.map(({ label, icon: ToolIcon }) => <IconButton label={label} key={label}
                disabled={!visualEditor || activeTab?.viewMode !== "visual"} onClick={() => runToolbarAction(label)}><ToolIcon size={17} /></IconButton>)}
            </div>)}
            <div className="toolbar-spacer" />
            <div className="mode-switch" role="group" aria-label="Editor mode">
              <button className={activeTab?.viewMode === "visual" ? "active" : ""} type="button" onClick={() => setMode("visual")}>Visual</button>
              <button className={activeTab?.viewMode === "raw" ? "active" : ""} type="button" onClick={() => setMode("raw")}><Braces size={14} /> Raw</button>
            </div>
            <IconButton label="Hide toolbar" onClick={() => setToolbarOpen(false)}><Minus size={17} /></IconButton>
          </div>}

          {activeTab?.status === "external" && <div className="conflict-banner">
            <span><strong>File changed outside GonzoWrite.</strong> Reload it or overwrite it with your current version.</span>
            <button type="button" onClick={() => void reloadTab(activeTab.id)}><RotateCcw size={14} /> Reload</button>
            <button type="button" onClick={() => void saveTab(activeTab.id, true)}><Save size={14} /> Overwrite</button>
          </div>}
          {activeTab?.status === "error" && <div className="conflict-banner error-banner"><span>{activeTab.error ?? "The document could not be saved."}</span></div>}

          <div className="editor-viewport">
            {!activeTab ? <div className="welcome-empty"><div className="brand-mark"><img src={logoUrl} alt="" /></div><h1>Start writing</h1>
              <p>Create a new Markdown document or open one from disk.</p><div><button onClick={() => newDocument()}>New note</button><button onClick={() => void openDialog()}>Open file</button></div></div>
            : <Suspense fallback={<div className="editor-loading">Preparing editor…</div>}>
              {activeTab.viewMode === "raw" ? <RawEditor content={activeTab.content} dark={dark} codeFont={codeFont} zoom={activeTab.zoom}
                onChange={(content) => updateTab(activeTab.id, { content, status: "dirty", error: undefined })} />
              : <VisualEditor content={activeTab.content} documentPath={activeTab.path} loadRemote={config.images.load_remote}
                editorFont={editorFont} codeFont={codeFont} zoom={activeTab.zoom}
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
