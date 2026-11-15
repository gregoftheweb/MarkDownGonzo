import { describe, expect, it } from "vitest";

import { mergeExternalChange } from "./externalMerge";

const base = "# Plan\n\n- [ ] one\n- [ ] two\n- [ ] three\n\nNotes.\n";

describe("mergeExternalChange", () => {
  it("no local edits: takes the file as it is now", () => {
    const theirs = base.replace("Notes.", "Notes, updated.");
    expect(mergeExternalChange(base, base, theirs)).toBe(theirs);
  });

  it("the file didn't really change: keeps local edits", () => {
    const ours = base.replace("- [ ] one", "- [x] one");
    expect(mergeExternalChange(base, ours, base)).toBe(ours);
  });

  it("edits to different lines combine", () => {
    const ours = base.replace("- [ ] one", "- [x] one");
    const theirs = base.replace("Notes.", "Notes, updated.\n\nMore.");
    expect(mergeExternalChange(base, ours, theirs)).toBe("# Plan\n\n- [x] one\n- [ ] two\n- [ ] three\n\nNotes, updated.\n\nMore.\n");
  });

  it("lines added on both sides in different places combine", () => {
    const ours = base.replace("- [ ] two\n", "- [ ] two\n- [ ] two and a half\n");
    const theirs = `Intro.\n${base}`;
    expect(mergeExternalChange(base, ours, theirs)).toBe(`Intro.\n${ours}`);
  });

  it("the same change on both sides isn't a conflict", () => {
    const both = base.replace("- [ ] two", "- [x] two");
    expect(mergeExternalChange(base, both, both)).toBe(both);
  });

  it("both sides changing the same line differently is a conflict", () => {
    const ours = base.replace("- [ ] two", "- [x] two");
    const theirs = base.replace("- [ ] two", "- [ ] two (renamed)");
    expect(mergeExternalChange(base, ours, theirs)).toBeNull();
  });

  it("a deletion on one side and an edit elsewhere on the other combine", () => {
    const ours = base.replace("- [ ] three\n", "");
    const theirs = base.replace("# Plan", "# The plan");
    expect(mergeExternalChange(base, ours, theirs)).toBe("# The plan\n\n- [ ] one\n- [ ] two\n\nNotes.\n");
  });

  it("keeps a missing final newline", () => {
    const b = "a\nb\nc";
    expect(mergeExternalChange(b, "A\nb\nc", "a\nb\nC")).toBe("A\nb\nC");
  });
});
