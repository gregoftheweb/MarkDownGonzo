import { describe, expect, it } from "vitest";

import { withEditedContent } from "./tabEdits";
import type { DocumentTab } from "./types";

const tab = (overrides: Partial<DocumentTab> = {}): DocumentTab => ({
  id: "/notes/a.md",
  path: "/notes/a.md",
  name: "a.md",
  content: "# Hello\n",
  savedContent: "# Hello\n",
  modifiedMs: 1,
  status: "saved",
  zoom: 100,
  viewMode: "visual",
  ...overrides,
});

describe("withEditedContent", () => {
  it("marks a real edit unsaved", () => {
    expect(withEditedContent(tab(), "# Hello there\n")).toMatchObject({
      content: "# Hello there\n",
      status: "dirty",
    });
  });

  it("leaves the tab alone when the content didn't change", () => {
    const before = tab();
    expect(withEditedContent(before, "# Hello\n")).toBe(before);
  });

  it("keeps a 'changed outside' tab's banner up on a no-change report (Reload in one click)", () => {
    const external = tab({ status: "external", error: "This file changed outside MarkDownGonzo." });
    expect(withEditedContent(external, "# Hello\n").status).toBe("external");
  });
});
