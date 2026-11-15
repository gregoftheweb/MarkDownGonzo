/**
 * The last theme the app showed, kept in the webview's localStorage so the
 * next launch can paint in it from the first frame instead of flashing the
 * default (dark) while config.toml loads. config.toml stays the source of
 * truth: once it loads, its appearance is applied and cached again.
 *
 * index.html reads the same key in an inline script, before any CSS or
 * React, to colour the page; keep the two in step.
 */
export const APPEARANCE_CACHE_KEY = "markdowngonzo.appearance";

export type CachedAppearance = { mode: "dark" | "light"; accent: string; skin: "studio" | "word" };

export function readCachedAppearance(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): CachedAppearance | null {
  try {
    const raw = storage?.getItem(APPEARANCE_CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedAppearance>;
    return {
      mode: value.mode === "light" ? "light" : "dark",
      accent: typeof value.accent === "string" ? value.accent : "tron",
      skin: value.skin === "word" ? "word" : "studio",
    };
  } catch {
    return null;
  }
}

export function cacheAppearance(appearance: CachedAppearance, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage can be unavailable; the theme then just loads from config.
  }
}
