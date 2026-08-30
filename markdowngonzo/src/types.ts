export type Accent = "tron" | "ferrari" | "mclaren" | "lambo";
export type ViewMode = "visual" | "raw";
export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "external";

export interface EditorSelection {
  from: number;
  to: number;
}

export interface RawEditorHandle {
  focus: () => void;
  getText: () => string;
  getSelection: () => EditorSelection;
  selectRange: (from: number, to: number) => void;
  replaceRange: (from: number, to: number, replacement: string) => void;
}

export interface DocumentSnapshot {
  path: string;
  name: string;
  content: string;
  modifiedMs: number;
  size: number;
}

export interface DocumentMetadata {
  modifiedMs: number;
  size: number;
}

export interface ImportedImage {
  relativePath: string;
  name: string;
}

export interface DocumentTab {
  id: string;
  path: string | null;
  name: string;
  content: string;
  savedContent: string;
  modifiedMs: number | null;
  status: SaveStatus;
  error?: string;
  zoom: number;
  viewMode: ViewMode;
}

export interface RecentNote {
  path: string;
  name: string;
  modifiedMs: number;
}

export interface SessionState {
  version: 1;
  openPaths: string[];
  openDocuments?: Array<Pick<DocumentTab, "path" | "zoom" | "viewMode">>;
  activePath: string | null;
  drafts: Array<Pick<DocumentTab, "id" | "name" | "content" | "zoom" | "viewMode">>;
  recentNotes: RecentNote[];
  sidebarOpen: boolean;
  toolbarOpen: boolean;
}

export interface AppConfig {
  editor: {
    font_family: string;
    font_size: number;
    code_font_family: string;
    code_font_size: number;
    zoom: number;
    spellcheck: boolean;
  };
  fonts: { families: string[] };
  appearance: { mode: string; accent: string };
  autosave: { enabled: boolean; delay_ms: number };
  images: { directory: string; load_remote: boolean };
}

export interface BackendError {
  kind?: string;
  message?: string;
  currentModifiedMs?: number;
}
