/**
 * Build a normalized key for grouping items into Products, so "New 3DS LL",
 * "new 3ds LL " and "New  3DS  ll" all collapse to one product for sold-count
 * history and the good-deal checker.
 */
export function normalizeKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ") // drop punctuation
    .replace(/\b(the|a|an|of|for|with|and)\b/g, " ") // stopwords
    .replace(/\s+/g, " ")
    .trim();
}

/** Token set of a title, for fuzzy name matching. */
export function tokenSet(title: string): Set<string> {
  return new Set(normalizeKey(title).split(" ").filter(Boolean));
}

/** Jaccard similarity (0–1) between two titles' token sets. */
export function similarity(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Levenshtein edit distance between two short strings — used to catch barcode
 * mis-scans (a code that's one digit off / transposed from an existing one).
 * Bails out early once the distance exceeds `max` for speed.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // no way back under max
    prev = cur;
  }
  return prev[b.length];
}
