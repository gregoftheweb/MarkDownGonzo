import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  chooseDocuments,
  chooseSavePath,
  confirmDiscard,
  documentMetadata,
  errorDetails,
  loadConfig,
  loadSession,
  readDocument,
  saveDocument,
  saveSession,
  startupPaths,
} from "./backend";
import type { AppConfig, DocumentSnapshot, DocumentTab, RecentNote, SessionState } from "./types";

const defaultConfig: AppConfig = {
  editor: { font_family: "sans-serif", font_size: 16, code_font_family: "monospace", code_font_size: 15, zoom: 1 },
  fonts: { families: ["sans-serif"] },
  appearance: { mode: "dark", accent: "tron" },
  autosave: { enabled: true, delay_ms: 1_000 },
  images: { directory: "assets", load_remote: true },
};

const untitled = (content = "", id: string = crypto.randomUUID()): DocumentTab => ({
  id,
  path: null,
  name: "Untitled.md",
  content,
  savedContent: "",
  modifiedMs: null,
  status: content ? "dirty" : "saved",
  zoom: 100,
  viewMode: "raw",
});

const fromSnapshot = (snapshot: DocumentSnapshot): DocumentTab => ({
  id: snapshot.path,
  path: snapshot.path,
  name: snapshot.name,
  content: snapshot.content,
  savedContent: snapshot.content,
  modifiedMs: snapshot.modifiedMs,
  status: "saved",
  zoom: 100,
  viewMode: "raw",
});

export function useDocuments() {
  const [tabs, setTabs] = useState<DocumentTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>([]);
  const [config, setConfig] = useState(defaultConfig);
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const touchRecent = useCallback((snapshot: DocumentSnapshot) => {
    setRecentNotes((current) =>
      [
        { path: snapshot.path, name: snapshot.name, modifiedMs: snapshot.modifiedMs },
        ...current.filter((note) => note.path !== snapshot.path),
      ].sort((a, b) => b.modifiedMs - a.modifiedMs),
    );
  }, []);

  const openPaths = useCallback(async (paths: string[], activate = true) => {
    let latestId: string | null = null;
    for (const path of paths) {
      const existing = tabsRef.current.find((tab) => tab.path === path);
      if (existing) {
        latestId = existing.id;
        continue;
      }
      try {
        const snapshot = await readDocument(path);
        const tab = fromSnapshot(snapshot);
        latestId = tab.id;
        setTabs((current) => current.some((item) => item.path === tab.path) ? current : [...current, tab]);
        touchRecent(snapshot);
      } catch {
        setRecentNotes((current) => current.filter((note) => note.path !== path));
      }
    }
    if (activate && latestId) setActiveId(latestId);
  }, [touchRecent]);

  const newDocument = useCallback((content = "") => {
    const tab = untitled(content);
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  }, []);

  const openDialog = useCallback(async () => {
    const paths = await chooseDocuments();
    await openPaths(paths);
  }, [openPaths]);

  const updateTab = useCallback((id: string, updates: Partial<DocumentTab>) => {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...updates } : tab));
  }, []);

  const saveTab = useCallback(async (id: string, force = false): Promise<boolean> => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) return false;

    let path = tab.path;
    if (!path) {
      path = await chooseSavePath(tab.name);
      if (!path) return false;
      if (!/\.(md|markdown)$/i.test(path)) path += ".md";
    }

    updateTab(id, { status: "saving", error: undefined });
    try {
      const snapshot = await saveDocument(path, tab.content, tab.modifiedMs, force);
      setTabs((current) => current.map((item) => item.id === id ? {
        ...item,
        id: snapshot.path,
        path: snapshot.path,
        name: snapshot.name,
        savedContent: snapshot.content,
        modifiedMs: snapshot.modifiedMs,
        status: "saved",
        error: undefined,
      } : item));
      setActiveId((current) => current === id ? snapshot.path : current);
      touchRecent(snapshot);
      return true;
    } catch (error) {
      const details = errorDetails(error);
      updateTab(id, {
        status: details.kind === "externalChange" ? "external" : "error",
        error: details.message,
      });
      return false;
    }
  }, [touchRecent, updateTab]);

  const reloadTab = useCallback(async (id: string) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab?.path) return;
    try {
      const snapshot = await readDocument(tab.path);
      updateTab(id, { ...fromSnapshot(snapshot), id });
      touchRecent(snapshot);
    } catch (error) {
      updateTab(id, { status: "error", error: errorDetails(error).message });
    }
  }, [touchRecent, updateTab]);

  const closeTab = useCallback(async (id: string) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) return;
    if (tab.status !== "saved" && !(await confirmDiscard(tab.name))) return;
    setTabs((current) => {
      const index = current.findIndex((item) => item.id === id);
      const next = current.filter((item) => item.id !== id);
      setActiveId((active) => active === id ? next[Math.min(index, next.length - 1)]?.id ?? null : active);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const [storedConfig, session, cliPaths] = await Promise.all([loadConfig(), loadSession(), startupPaths()]);
        if (cancelled) return;
        setConfig(storedConfig);
        if (session) {
          const validatedRecents = (await Promise.all((session.recentNotes ?? []).map(async (note) => {
            try {
              const metadata = await documentMetadata(note.path);
              return { ...note, modifiedMs: metadata.modifiedMs };
            } catch {
              return null;
            }
          }))).filter((note): note is RecentNote => note !== null);
          setRecentNotes(validatedRecents.sort((a, b) => b.modifiedMs - a.modifiedMs));
          setSidebarOpen(session.sidebarOpen ?? true);
          setToolbarOpen(session.toolbarOpen ?? true);
          for (const draft of session.drafts ?? []) {
            const tab = { ...untitled(draft.content, draft.id), ...draft, status: "dirty" as const };
            setTabs((current) => [...current, tab]);
          }
          await openPaths(session.openPaths ?? [], false);
          if (session.openDocuments) {
            setTabs((current) => current.map((tab) => {
              const preferences = session.openDocuments?.find((item) => item.path === tab.path);
              return preferences ? { ...tab, zoom: preferences.zoom, viewMode: preferences.viewMode } : tab;
            }));
          }
          if (session.activePath) setActiveId(session.activePath);
        }
        await openPaths(cliPaths);
        if (cliPaths.length === 0 && !(session?.drafts?.length) && !(session?.openPaths?.length)) newDocument();
        unlisten = await listen<string[]>("open-paths", (event) => void openPaths(event.payload));
      } catch (error) {
        console.error("GonzoWrite startup failed", error);
        newDocument();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; unlisten?.(); };
  }, [newDocument, openPaths]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop") void openPaths(event.payload.paths);
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [openPaths]);

  useEffect(() => {
    if (!ready) return;
    const timers = tabs
      .filter((tab) => tab.path && tab.status === "dirty" && config.autosave.enabled)
      .map((tab) => window.setTimeout(() => void saveTab(tab.id), config.autosave.delay_ms));
    return () => timers.forEach(window.clearTimeout);
  }, [config.autosave.delay_ms, config.autosave.enabled, ready, saveTab, tabs]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      const state: SessionState = {
        version: 1,
        openPaths: tabs.flatMap((tab) => tab.path ? [tab.path] : []),
        openDocuments: tabs.filter((tab) => tab.path).map(({ path, zoom, viewMode }) => ({ path, zoom, viewMode })),
        activePath: tabs.find((tab) => tab.id === activeId)?.path ?? null,
        drafts: tabs.filter((tab) => !tab.path).map(({ id, name, content, zoom, viewMode }) => ({ id, name, content, zoom, viewMode })),
        recentNotes,
        sidebarOpen,
        toolbarOpen,
      };
      void saveSession(state).catch((error) => console.error("Unable to save session", error));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeId, ready, recentNotes, sidebarOpen, tabs, toolbarOpen]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      for (const tab of tabsRef.current.filter((item) => item.path && item.status !== "saving" && item.status !== "external")) {
        void documentMetadata(tab.path!).then((metadata) => {
          if (tab.modifiedMs !== null && metadata.modifiedMs !== tab.modifiedMs) {
            updateTab(tab.id, { status: "external", error: "This file changed outside GonzoWrite." });
          }
        }).catch(() => {
          setRecentNotes((current) => current.filter((note) => note.path !== tab.path));
        });
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [ready, updateTab]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (tabsRef.current.some((tab) => !tab.path || tab.status === "error" || tab.status === "external")) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;

  return {
    tabs, activeTab, activeId, setActiveId, recentNotes, setRecentNotes, config, ready,
    sidebarOpen, setSidebarOpen, toolbarOpen, setToolbarOpen,
    newDocument, openDialog, openPaths, updateTab, saveTab, reloadTab, closeTab,
  };
}
