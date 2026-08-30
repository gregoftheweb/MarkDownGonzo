// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "./editorExtensions";
import { combineMarkdown, splitFrontmatter } from "./markdown";

const editors: Editor[] = [];

function roundTrip(source: string) {
  const { frontmatter, body } = splitFrontmatter(source);
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: body,
    contentType: "markdown",
  });
  editors.push(editor);
  return combineMarkdown(frontmatter, editor.getMarkdown());
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("TipTap GFM round trips", () => {
  it("preserves frontmatter and core block structure", () => {
    const output = roundTrip("---\ntitle: Test\n---\n# Heading\n\n> Quote\n\n```ts\nconst ok = true\n```\n");
    expect(output).toContain("---\ntitle: Test\n---\n");
    expect(output).toContain("# Heading");
    expect(output).toContain("> Quote");
    expect(output).toContain("```ts\nconst ok = true\n```");
  });

  it("updates and preserves fenced code block languages", () => {
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: "```js\nconst answer = 42\n```\n",
      contentType: "markdown",
    });
    editors.push(editor);
    expect(editor.getAttributes("codeBlock").language).toBe("js");
    editor.chain().selectAll().updateAttributes("codeBlock", { language: "typescript" }).run();
    expect(editor.getMarkdown()).toContain("```typescript\nconst answer = 42\n```");
  });

  it("preserves GFM tables and task lists", () => {
    const output = roundTrip("- [x] Done\n- [ ] Next\n\n| Name | Ready |\n| --- | --- |\n| Gonzo | Yes |\n");
    expect(output).toContain("- [x] Done");
    expect(output).toContain("- [ ] Next");
    expect(output).toMatch(/\|\s*Name\s*\|\s*Ready\s*\|/);
    expect(output).toMatch(/\|\s*Gonzo\s*\|\s*Yes\s*\|/);
  });

  it("preserves links, images, and inline emphasis", () => {
    const output = roundTrip("A **bold** and *italic* [link](https://example.com).\n\n![Alt](assets/image.png)\n");
    expect(output).toContain("**bold**");
    expect(output).toContain("*italic*");
    expect(output).toContain("[link](https://example.com)");
    expect(output).toContain("![Alt](assets/image.png)");
  });

  it("round trips the documented HTML underline extension", () => {
    expect(roundTrip("A <u>careful underline</u>.\n")).toContain("<u>careful underline</u>");
  });
});
