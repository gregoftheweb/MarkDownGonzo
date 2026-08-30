import { describe, expect, it } from "vitest";
import { combineMarkdown, splitFrontmatter, visualSafetyWarnings } from "./markdown";

describe("Markdown boundary", () => {
  it("preserves YAML frontmatter byte for byte", () => {
    const source = "---\ntitle: MarkDownGonzo\ntags: [linux, markdown]\n---\n# Hello\n";
    const parts = splitFrontmatter(source);
    expect(parts.frontmatter).toBe("---\ntitle: MarkDownGonzo\ntags: [linux, markdown]\n---\n");
    expect(combineMarkdown(parts.frontmatter, parts.body)).toBe(source);
  });

  it("supports the YAML document-end marker", () => {
    const parts = splitFrontmatter("---\ntitle: Test\n...\nBody");
    expect(parts.frontmatter).toBe("---\ntitle: Test\n...\n");
    expect(parts.body).toBe("Body");
  });

  it("does not mistake a horizontal rule later in a document for frontmatter", () => {
    expect(splitFrontmatter("# Heading\n\n---\n\nBody").frontmatter).toBe("");
  });

  it("flags syntax that cannot safely enter the visual editor", () => {
    const warnings = visualSafetyWarnings("<!-- keep -->\n\n<Component />\n\n<p align=\"center\">Logo</p>\n\n[^1]: Note");
    expect(warnings).toEqual(["JSX components", "raw HTML", "HTML comments", "footnotes"]);
  });

  it("allows the documented underline HTML and Markdown autolinks", () => {
    expect(visualSafetyWarnings("<u>Underlined</u> and <https://example.com>")).toEqual([]);
  });

  it("accepts representative GitHub-Flavored Markdown", () => {
    const source = "# Heading\n\n- [x] Task\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst ok = true\n```";
    expect(visualSafetyWarnings(source)).toEqual([]);
  });

  it("does not treat syntax shown in code as live unsupported content", () => {
    const source = [
      "```tsx",
      'import Card from "./Card"',
      "<Card><p>Example</p></Card>",
      "<!-- example comment -->",
      "```",
      "",
      "Inline `<Widget />` and `<section>example</section>`.",
    ].join("\n");
    expect(visualSafetyWarnings(source)).toEqual([]);
  });

  it("still flags unsupported syntax outside code fences", () => {
    const source = "```html\n<section>safe example</section>\n```\n\n<Component />";
    expect(visualSafetyWarnings(source)).toEqual(["JSX components", "raw HTML"]);
  });
});
