import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Characters of a team description a picker row keeps before the ellipsis. */
const TEAM_DESCRIPTION_PREVIEW_LENGTH = 80;

/**
 * One-line preview of a team description for a picker row.
 *
 * The row also clips with `truncate`, but that only ellipsizes what the row is
 * actually too narrow for — a wide dropdown would still spell out a paragraph.
 * Cutting the string keeps every row to one readable line; callers keep the
 * full text in the row's `title`.
 */
export function truncateTeamDescription(description: string): string {
  if (description.length <= TEAM_DESCRIPTION_PREVIEW_LENGTH) {
    return description;
  }
  return `${description.slice(0, TEAM_DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`;
}

export function filterTagsByText<T extends { tag_text: string }>(
  tags: T[] | null | undefined,
  query: string
): T[] {
  if (!tags) {
    return [];
  }
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return tags;
  }

  return tags.filter((tag) => tag.tag_text.toLowerCase().includes(normalizedQuery));
}
