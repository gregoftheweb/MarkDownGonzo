import { describe, expect, it } from "vitest";
import { exportFileName } from "./backend";

describe("exportFileName", () => {
  it("swaps a markdown extension for the export extension", () => {
    expect(exportFileName("Report.md", "pdf")).toBe("Report.pdf");
    expect(exportFileName("notes.markdown", "odt")).toBe("notes.odt");
  });

  it("keeps other dotted names intact", () => {
    expect(exportFileName("v1.2.release.md", "pdf")).toBe("v1.2.release.pdf");
  });

  it("falls back to Untitled for empty or extension-only names", () => {
    expect(exportFileName("", "odt")).toBe("Untitled.odt");
    expect(exportFileName(".md", "pdf")).toBe("Untitled.pdf");
  });

  it("does not require a markdown extension on the source", () => {
    expect(exportFileName("draft", "pdf")).toBe("draft.pdf");
  });
});
