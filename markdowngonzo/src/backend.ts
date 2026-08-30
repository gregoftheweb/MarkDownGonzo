import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import type {
  AppConfig,
  DocumentMetadata,
  DocumentSnapshot,
  ImportedImage,
  SessionState,
} from "./types";

const markdownFilter = [{ name: "Markdown", extensions: ["md", "markdown"] }];

export async function chooseDocuments(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: markdownFilter,
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function chooseSavePath(defaultPath?: string): Promise<string | null> {
  return save({
    defaultPath,
    filters: markdownFilter,
  });
}

export type ExportFormat = "odt" | "pdf";

const exportMeta: Record<ExportFormat, { name: string; extension: string }> = {
  odt: { name: "OpenDocument Text", extension: "odt" },
  pdf: { name: "PDF document", extension: "pdf" },
};

/** Default export file name derived from the source document name. */
export function exportFileName(sourceName: string, format: ExportFormat): string {
  const stem = (sourceName || "Untitled").replace(/\.(md|markdown)$/i, "").trim() || "Untitled";
  return `${stem}.${exportMeta[format].extension}`;
}

export async function chooseExportPath(format: ExportFormat, defaultName: string): Promise<string | null> {
  const { name, extension } = exportMeta[format];
  const chosen = await save({ defaultPath: defaultName, filters: [{ name, extensions: [extension] }] });
  if (!chosen) return null;
  return chosen.toLowerCase().endsWith(`.${extension}`) ? chosen : `${chosen}.${extension}`;
}

export const exportDocument = (request: {
  markdown: string;
  destination: string;
  documentDir: string | null;
  title: string | null;
}) => invoke<{ path: string; format: string }>("export_document", { request });

export async function chooseImages(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function confirmDiscard(name: string): Promise<boolean> {
  return confirm(`Close ${name} and discard its unsaved changes?`, {
    title: "Unsaved changes",
    kind: "warning",
  });
}

export const readDocument = (path: string) =>
  invoke<DocumentSnapshot>("read_document", { path });

export const documentMetadata = (path: string) =>
  invoke<DocumentMetadata>("document_metadata", { path });

export const saveDocument = (
  path: string,
  content: string,
  expectedModifiedMs: number | null,
  force = false,
) =>
  invoke<DocumentSnapshot>("save_document", {
    path,
    content,
    expectedModifiedMs,
    force,
  });

export const loadSession = () => invoke<SessionState | null>("load_session");
export const saveSession = (session: SessionState) =>
  invoke<void>("save_session", { session });
export const loadConfig = () => invoke<AppConfig>("load_config");
export const saveConfig = (config: AppConfig) => invoke<AppConfig>("save_config", { config });
export const startupPaths = () => invoke<string[]>("startup_paths");
export const openLocalLink = (documentPath: string, target: string) =>
  invoke<void>("open_local_link", { documentPath, target });
export const readImageDataUrl = (documentPath: string, source: string) =>
  invoke<string>("read_image_data_url", { documentPath, source });
export const importImageFile = (documentPath: string, sourcePath: string, preferredDirectory: string) =>
  invoke<ImportedImage>("import_image_file", { documentPath, sourcePath, preferredDirectory });
export const importImageBytes = (
  documentPath: string,
  bytes: number[],
  sourceName: string,
  preferredDirectory: string,
) => invoke<ImportedImage>("import_image_bytes", { documentPath, bytes, sourceName, preferredDirectory });
export const trashImageFile = (documentPath: string, source: string) =>
  invoke<void>("trash_image_file", { documentPath, source });

export function errorDetails(error: unknown): { kind: string; message: string } {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { kind?: unknown; message?: unknown };
    return {
      kind: typeof candidate.kind === "string" ? candidate.kind : "error",
      message: typeof candidate.message === "string" ? candidate.message : JSON.stringify(error),
    };
  }
  return { kind: "error", message: String(error) };
}
