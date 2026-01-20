import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
