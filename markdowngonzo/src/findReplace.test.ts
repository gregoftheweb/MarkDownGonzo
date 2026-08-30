import { describe, expect, it } from "vitest";
import { findTextMatches, matchesSelection, nextMatchIndex } from "./findReplace";

describe("find and replace helpers", () => {
  it("finds non-overlapping matches without case sensitivity by default", () => {
    expect(findTextMatches("Gonzo gonzo GONZO", "gonzo")).toEqual([
      { from: 0, to: 5 }, { from: 6, to: 11 }, { from: 12, to: 17 },
    ]);
  });

  it("supports case-sensitive matching", () => {
    expect(findTextMatches("Gonzo gonzo", "gonzo", true)).toEqual([{ from: 6, to: 11 }]);
  });

  it("wraps next and previous navigation", () => {
    const matches = findTextMatches("one two one", "one");
    expect(nextMatchIndex(matches, 1, 1)).toBe(1);
    expect(nextMatchIndex(matches, 12, 1)).toBe(0);
    expect(nextMatchIndex(matches, 7, -1)).toBe(0);
    expect(nextMatchIndex(matches, 0, -1)).toBe(1);
  });

  it("checks the current selection using the chosen case behavior", () => {
    expect(matchesSelection("Hello", "hello", 0, 5)).toBe(true);
    expect(matchesSelection("Hello", "hello", 0, 5, true)).toBe(false);
  });
});
