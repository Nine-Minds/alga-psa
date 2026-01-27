import React from 'react';

/**
 * Highlights matching text in search results by wrapping matches in <mark> tags.
 *
 * @param text - The text to search within
 * @param query - The search query to highlight
 * @param caseSensitive - Whether the search is case sensitive
 * @param wholeWord - Whether to match whole words only
 * @returns React nodes with matching text highlighted
 */
export const highlightSearchMatch = (
  text: string,
  query: string,
  caseSensitive: boolean = false,
  wholeWord: boolean = false
): React.ReactNode => {
  if (!query.trim()) return text;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wholeWord ? `\\b(${escapedQuery})\\b` : `(${escapedQuery})`;
  const splitRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  const testRegex = new RegExp(pattern, caseSensitive ? '' : 'i');
  const parts = text.split(splitRegex);

  return parts.map((part, index) =>
    testRegex.test(part) ? (
      <mark
        key={index}
        className="bg-[rgb(var(--color-primary-200))] text-[rgb(var(--color-primary-900))] rounded px-0.5"
      >
        {part}
      </mark>
    ) : part
  );
};
