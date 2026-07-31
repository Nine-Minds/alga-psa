/**
 * "Did you mean …" suggestions for validation errors. Names in workflow
 * definitions (action ids, event names, expression functions) are authored by
 * models and humans; a near-miss should come back with the correction instead
 * of a bare "unknown".
 */

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/**
 * Nearest candidate to `input` within a sane edit-distance budget
 * (scaled to input length), or null when nothing is plausibly close.
 */
export function findNearestName(input: string, candidates: Iterable<string>): string | null {
  const needle = input.trim().toLowerCase();
  if (!needle) return null;
  const budget = needle.length <= 4 ? 1 : needle.length <= 8 ? 2 : 3;

  let best: string | null = null;
  let bestDistance = budget + 1;
  for (const candidate of candidates) {
    const distance = levenshteinDistance(needle, candidate.trim().toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      if (distance === 0) break;
    }
  }
  return bestDistance <= budget ? best : null;
}

/** Formats the standard suggestion string, or null when there is none. */
export function didYouMean(input: string, candidates: Iterable<string>): string | null {
  const nearest = findNearestName(input, candidates);
  return nearest && nearest !== input ? `Did you mean "${nearest}"?` : null;
}
