import type { DocumentTab } from "./types";

/**
 * The tab after the editor reports its content. Only an actual change marks
 * it unsaved: the visual editor reports on every blur, edited or not, and
 * treating that as an edit flipped a "changed outside MarkDownGonzo" tab to
 * "Unsaved" - which removed the conflict banner, Reload button included,
 * mid-click, so Reload took two clicks.
 */
export function withEditedContent(tab: DocumentTab, content: string): DocumentTab {
  if (tab.content === content) return tab;
  return { ...tab, content, status: "dirty", error: undefined };
}
