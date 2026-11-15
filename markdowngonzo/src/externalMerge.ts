/**
 * Three-way merge for a file that changed on disk while it was open (line
 * based, like git): `base` is what was last loaded or saved, `ours` is the
 * editor's text, `theirs` is the file now. Edits to different lines combine;
 * if both sides changed the same lines differently, it's a conflict (null)
 * and the user chooses Reload or Overwrite.
 */
export function mergeExternalChange(base: string, ours: string, theirs: string): string | null {
  if (ours === base || ours === theirs) return theirs;
  if (theirs === base) return ours;

  const o = lines(base);
  const a = lines(ours);
  const b = lines(theirs);
  const inA = matchLines(o, a);
  const inB = matchLines(o, b);

  const out: string[] = [];
  let io = 0;
  let ia = 0;
  let ib = 0;
  // Walk the base, stopping at each line both sides kept unchanged; between
  // two such lines, each side has either left the base alone or changed it.
  for (let sync = 0; sync <= o.length; sync++) {
    const atEnd = sync === o.length;
    if (!atEnd && (inA[sync] === -1 || inB[sync] === -1)) continue;
    const endA = atEnd ? a.length : inA[sync];
    const endB = atEnd ? b.length : inB[sync];
    const chunk = resolve(o.slice(io, sync), a.slice(ia, endA), b.slice(ib, endB));
    if (chunk === null) return null;
    out.push(...chunk);
    if (!atEnd) out.push(o[sync]);
    io = sync + 1;
    ia = endA + 1;
    ib = endB + 1;
  }
  return out.join("");
}

/** Lines, each keeping its own line ending, so joining restores the text. */
const lines = (text: string) => (text === "" ? [] : text.split(/(?<=\n)/));

const same = (x: string[], y: string[]) => x.length === y.length && x.every((line, i) => line === y[i]);

/** One changed stretch: whichever side changed it wins; both differently is a conflict. */
function resolve(o: string[], a: string[], b: string[]): string[] | null {
  if (same(a, o)) return b;
  if (same(b, o) || same(a, b)) return a;
  return null;
}

/**
 * For each base line, the index of the line it matches in `other` (longest
 * common subsequence), or -1. The common start and end are matched directly,
 * so a local edit to a long document stays cheap.
 */
function matchLines(o: string[], other: string[]): number[] {
  const match = new Array<number>(o.length).fill(-1);
  let start = 0;
  while (start < o.length && start < other.length && o[start] === other[start]) {
    match[start] = start;
    start++;
  }
  let endO = o.length;
  let endX = other.length;
  while (endO > start && endX > start && o[endO - 1] === other[endX - 1]) {
    endO--;
    endX--;
    match[endO] = endX;
  }
  const n = endO - start;
  const m = endX - start;
  if (n === 0 || m === 0) return match;
  // lcs[i][j]: longest common subsequence of o[start+i..] and other[start+j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = o[start + i] === other[start + j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (o[start + i] === other[start + j]) {
      match[start + i] = start + j;
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return match;
}
