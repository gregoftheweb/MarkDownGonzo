import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bold,
  Braces,
  CheckSquare,
  ChevronDown,
  Code2,
  Columns3,
  FilePlus2,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Quote,
  Redo2,
  Save,
  Search,
  Settings2,
  Strikethrough,
  Sun,
  Table2,
  Underline,
  Undo2,
  X,
} from "lucide-react";

type Accent = "tron" | "ferrari" | "mclaren" | "lambo";
type ViewMode = "visual" | "raw";

const notes = [
  { name: "README.md", path: "~/Devplex/GonzoWrite", when: "Just now" },
  { name: "launch-notes.md", path: "~/Documents", when: "Yesterday" },
  { name: "linux-setup.md", path: "~/Notes", when: "Aug 26" },
  { name: "ideas.md", path: "~/Notes", when: "Aug 21" },
];

const sampleMarkdown = `# Welcome to GonzoWrite

A focused, local-first editor for **beautiful writing** and clean GitHub-flavored Markdown.

## Built for the way you work

- Write in a calm visual canvas
- Switch to raw Markdown whenever you need it
- Keep every document portable

> Your files stay yours. No accounts, no proprietary format, no noise.

\`\`\`typescript
const document = await open("README.md");
await document.write();
\`\`\`
`;

const toolbarGroups = [
  [
    { label: "Undo", icon: Undo2 },
    { label: "Redo", icon: Redo2 },
  ],
  [
    { label: "Bold", icon: Bold },
    { label: "Italic", icon: Italic },
    { label: "Underline", icon: Underline },
    { label: "Strikethrough", icon: Strikethrough },
  ],
  [
    { label: "Heading 1", icon: Heading1 },
    { label: "Heading 2", icon: Heading2 },
    { label: "Heading 3", icon: Heading3 },
  ],
  [
    { label: "Bullet list", icon: List },
    { label: "Numbered list", icon: ListOrdered },
    { label: "Task list", icon: CheckSquare },
    { label: "Quote", icon: Quote },
  ],
  [
    { label: "Link", icon: Link },
    { label: "Image", icon: ImagePlus },
    { label: "Table", icon: Table2 },
    { label: "Code", icon: Code2 },
  ],
];

function IconButton({
  label,
  children,
  active = false,
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`icon-button${active ? " active" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [dark, setDark] = useState(true);
  const [accent, setAccent] = useState<Accent>("tron");
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [zoom, setZoom] = useState(100);
  const [query, setQuery] = useState("");
  const [markdown, setMarkdown] = useState(sampleMarkdown);

  const filteredNotes = useMemo(
    () =>
      notes.filter((note) =>
        `${note.name} ${note.path}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((value) => Math.min(180, value + 10));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom((value) => Math.max(60, value - 10));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(100);
      } else if (event.altKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setViewMode((mode) => (mode === "visual" ? "raw" : "visual"));
      } else if (event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setToolbarOpen((open) => !open);
      } else if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSidebarOpen(false);
        setToolbarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="app" data-theme={dark ? "dark" : "light"} data-accent={accent}>
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <span>GonzoWrite</span>
        </div>
        <div className="title-actions">
          {!toolbarOpen && (
            <IconButton label="Show toolbar" onClick={() => setToolbarOpen(true)}>
              <Menu size={17} />
            </IconButton>
          )}
          <div className="theme-picker" aria-label="Accent color">
            {(["tron", "ferrari", "mclaren", "lambo"] as Accent[]).map((color) => (
              <button
                key={color}
                className={`swatch ${color}${accent === color ? " selected" : ""}`}
                type="button"
                title={`${color} accent`}
                aria-label={`${color} accent`}
                onClick={() => setAccent(color)}
              />
            ))}
          </div>
          <IconButton label={dark ? "Use light theme" : "Use dark theme"} onClick={() => setDark((value) => !value)}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>
          <IconButton label="Settings">
            <Settings2 size={17} />
          </IconButton>
        </div>
      </header>

      <section className={`workspace${sidebarOpen ? "" : " sidebar-hidden"}`}>
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-heading">
              <div>
                <span className="eyebrow">Your writing</span>
                <h2>Recent notes</h2>
              </div>
              <IconButton label="Collapse notes" onClick={() => setSidebarOpen(false)}>
                <PanelLeftClose size={18} />
              </IconButton>
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                type="search"
                placeholder="Search recent notes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>⌘K</kbd>
            </label>
            <div className="sidebar-buttons">
              <button type="button"><FilePlus2 size={16} /> New note</button>
              <button type="button"><FolderOpen size={16} /> Open file</button>
            </div>
            <nav className="note-list" aria-label="Recent notes">
              {filteredNotes.map((note, index) => (
                <button className={`note-card${index === 0 ? " selected" : ""}`} type="button" key={`${note.path}/${note.name}`}>
                  <span className="note-icon">MD</span>
                  <span className="note-copy">
                    <strong>{note.name}</strong>
                    <small>{note.path}</small>
                  </span>
                  <time>{note.when}</time>
                </button>
              ))}
            </nav>
            <button className="clear-recents" type="button">Clear recent notes</button>
          </aside>
        )}

        <section className="document-area">
          <div className="tab-row">
            {!sidebarOpen && (
              <IconButton label="Show notes" onClick={() => setSidebarOpen(true)}>
                <PanelLeftOpen size={18} />
              </IconButton>
            )}
            <div className="tab active-tab">
              <span className="tab-dot" />
              README.md
              <button type="button" aria-label="Close README tab"><X size={14} /></button>
            </div>
            <div className="tab">
              launch-notes.md
              <button type="button" aria-label="Close launch notes tab"><X size={14} /></button>
            </div>
            <IconButton label="New tab"><Plus size={17} /></IconButton>
            <div className="tab-spacer" />
            <IconButton label="Save"><Save size={17} /></IconButton>
            <IconButton label="More tab actions"><MoreHorizontal size={18} /></IconButton>
          </div>

          {toolbarOpen && (
            <div className="toolbar" role="toolbar" aria-label="Formatting">
              <label className="select-control font-select">
                <span className="sr-only">Document font</span>
                <select defaultValue="sans-serif">
                  <option value="sans-serif">Omarchy Sans</option>
                </select>
                <ChevronDown size={14} />
              </label>
              <label className="select-control style-select">
                <span className="sr-only">Text style</span>
                <select defaultValue="paragraph">
                  <option value="paragraph">Paragraph</option>
                  <option value="h1">Heading 1</option>
                  <option value="h2">Heading 2</option>
                  <option value="h3">Heading 3</option>
                </select>
                <ChevronDown size={14} />
              </label>
              {toolbarGroups.map((group, groupIndex) => (
                <div className="tool-group" key={groupIndex}>
                  {group.map(({ label, icon: ToolIcon }) => (
                    <IconButton label={label} key={label}>
                      <ToolIcon size={17} />
                    </IconButton>
                  ))}
                </div>
              ))}
              <div className="toolbar-spacer" />
              <div className="mode-switch" role="group" aria-label="Editor mode">
                <button className={viewMode === "visual" ? "active" : ""} type="button" onClick={() => setViewMode("visual")}>Visual</button>
                <button className={viewMode === "raw" ? "active" : ""} type="button" onClick={() => setViewMode("raw")}><Braces size={14} /> Raw</button>
              </div>
              <IconButton label="Hide toolbar" onClick={() => setToolbarOpen(false)}>
                <Minus size={17} />
              </IconButton>
            </div>
          )}

          <div className="editor-viewport">
            {viewMode === "visual" ? (
              <article className="paper" style={{ fontSize: `${zoom}%` }}>
                <p className="document-kicker">README.md</p>
                <h1>Welcome to <span>GonzoWrite</span></h1>
                <p className="lede">A focused, local-first editor for <strong>beautiful writing</strong> and clean GitHub-flavored Markdown.</p>
                <hr />
                <h2>Built for the way you work</h2>
                <ul>
                  <li>Write in a calm visual canvas</li>
                  <li>Switch to raw Markdown whenever you need it</li>
                  <li>Keep every document portable</li>
                </ul>
                <blockquote>Your files stay yours. No accounts, no proprietary format, no noise.</blockquote>
                <pre data-language="typescript"><code><span className="code-keyword">const</span> document = <span className="code-keyword">await</span> open(<span className="code-string">&quot;README.md&quot;</span>);{"\n"}<span className="code-keyword">await</span> document.write();</code></pre>
              </article>
            ) : (
              <div className="raw-wrap" style={{ fontSize: `${zoom}%` }}>
                <div className="raw-gutter" aria-hidden="true">{markdown.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div>
                <textarea aria-label="Raw Markdown" spellCheck={false} value={markdown} onChange={(event) => setMarkdown(event.target.value)} />
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span className="save-state"><span /> Saved</span>
            <span>GitHub Markdown</span>
            <span className="status-spacer" />
            <span>74 words</span>
            <div className="zoom-control">
              <button type="button" onClick={() => setZoom((value) => Math.max(60, value - 10))} aria-label="Zoom out"><Minus size={14} /></button>
              <button type="button" onClick={() => setZoom(100)}>{zoom}%</button>
              <button type="button" onClick={() => setZoom((value) => Math.min(180, value + 10))} aria-label="Zoom in"><Plus size={14} /></button>
            </div>
            <span>Ln 1, Col 1</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
