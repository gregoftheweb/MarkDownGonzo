import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import type {
  AppConfig,
  DocumentMetadata,
  DocumentSnapshot,
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
export const startupPaths = () => invoke<string[]>("startup_paths");
export const openLocalLink = (documentPath: string, target: string) =>
  invoke<void>("open_local_link", { documentPath, target });

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
