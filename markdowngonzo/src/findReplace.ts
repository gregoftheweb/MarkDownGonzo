export interface TextMatch {
  from: number;
  to: number;
}

export function findTextMatches(text: string, query: string, caseSensitive = false): TextMatch[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    matches.push({ from: index, to: index + query.length });
    from = index + Math.max(query.length, 1);
  }
  return matches;
}

export function nextMatchIndex(matches: TextMatch[], position: number, direction: 1 | -1): number {
  if (!matches.length) return -1;
  if (direction === 1) {
    const next = matches.findIndex((match) => match.from >= position);
    return next < 0 ? 0 : next;
  }
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    if (matches[index].to <= position) return index;
  }
  return matches.length - 1;
}

export function matchesSelection(text: string, query: string, from: number, to: number, caseSensitive = false) {
  if (!query || from === to) return false;
  const selected = text.slice(from, to);
  return caseSensitive ? selected === query : selected.toLocaleLowerCase() === query.toLocaleLowerCase();
}
