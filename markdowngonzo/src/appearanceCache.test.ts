import { describe, expect, it } from "vitest";

import { APPEARANCE_CACHE_KEY, cacheAppearance, readCachedAppearance } from "./appearanceCache";

const memory = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
};

describe("appearance cache", () => {
  it("round-trips the last theme", () => {
    const storage = memory();
    cacheAppearance({ mode: "light", accent: "ferrari", skin: "word" }, storage);
    expect(readCachedAppearance(storage)).toEqual({ mode: "light", accent: "ferrari", skin: "word" });
  });

  it("nothing cached yet: null, so the app uses its defaults", () => {
    expect(readCachedAppearance(memory())).toBeNull();
  });

  it("junk or partial values fall back safely", () => {
    const storage = memory();
    storage.setItem(APPEARANCE_CACHE_KEY, "{not json");
    expect(readCachedAppearance(storage)).toBeNull();
    storage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({ mode: "light" }));
    expect(readCachedAppearance(storage)).toEqual({ mode: "light", accent: "tron", skin: "studio" });
  });

  it("storage that throws is ignored", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readCachedAppearance(broken)).toBeNull();
    expect(() => cacheAppearance({ mode: "dark", accent: "tron", skin: "studio" }, broken)).not.toThrow();
  });
});
