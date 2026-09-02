// Font pickers store a plain family name (the menu label). This turns that name
// into a CSS `font-family` value with a sensible fallback, and covers the few
// families whose real name differs from the label or that have no free version.

const FONT_ALIASES: Record<string, string> = {
  // Futura has no free release; Jost* is the usual open stand-in (its family
  // name carries the asterisk).
  Futura: `"Futura", "Futura PT", "Jost*", "Jost", "Century Gothic"`,
  // The compiled OpenDyslexic mono face registers without the space.
  "OpenDyslexic Mono": `"OpenDyslexic Mono", "OpenDyslexicMono"`,
};

export function cssFontStack(name: string, kind: "sans" | "mono"): string {
  const head = FONT_ALIASES[name] ?? `"${name}"`;
  const tail = kind === "mono" ? "ui-monospace, SFMono-Regular, monospace" : "system-ui, sans-serif";
  return `${head}, ${tail}`;
}
