export function normalizeSavedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function addTagFilter(tags: string[], tagText: string): string[] {
  const text = tagText.trim();
  if (!text) return tags;
  if (tags.some((tag) => tag.toLowerCase() === text.toLowerCase())) return tags;
  return [...tags, text];
}

export function removeTagFilter(tags: string[], tagText: string): string[] {
  const key = tagText.trim().toLowerCase();
  const next = tags.filter((tag) => tag.toLowerCase() !== key);
  return next.length === tags.length ? tags : next;
}

export function withTagsFilter(
  filters: Record<string, unknown> | undefined,
  tags: string[] | undefined,
): Record<string, unknown> | undefined {
  const cleaned = (tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  if (cleaned.length === 0) return filters;
  return { ...(filters ?? {}), tags: cleaned.join(",") };
}
