/**
 * Small shared helpers for parsing inbound MIME. New durable-path code uses
 * these instead of the historical per-file duplicates.
 */

/**
 * Extract a normalized list of RFC message ids from a references / in-reply-to
 * value (string or array), preserving surrounding angle brackets.
 */
export function extractMessageIds(value: unknown): string[] {
  const entries: string[] = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const normalized = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const matches = trimmed.match(/<[^<>]+>/g);
    if (matches?.length) {
      for (const match of matches) {
        const cleaned = match.trim();
        if (cleaned.length > 2) normalized.add(cleaned);
      }
      continue;
    }
    if (trimmed.length > 2) normalized.add(trimmed);
  }
  return Array.from(normalized);
}
