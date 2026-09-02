// Font pickers store a plain family name (the menu label). Every offered family
// is bundled (src/assets/fonts.css) under exactly that name, so this just adds a
// generic fallback for the brief moment before the face loads.

export function cssFontStack(name: string, kind: "sans" | "mono"): string {
  const fallback = kind === "mono" ? "ui-monospace, SFMono-Regular, monospace" : "system-ui, sans-serif";
  return `"${name}", ${fallback}`;
}
