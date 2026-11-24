/**
 * Grouping and plain search for a designer palette.
 *
 * LEVERAGE: pattern palette-search-ranking — the workflow designer's `paletteSearch.ts` adds a
 * domain synonym table and a match-tier ranking on top of this. Those parts are bound to the
 * MSP help-desk vocabulary and to workflow item shapes, so they stayed there; the ordering and
 * the word-variant matcher below are the generic half and live here.
 */

const normalizePaletteSearchValue = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** Singular/plural variants of one word, so "dates" finds "date". */
const getTokenVariants = (token: string): string[] => {
  const normalizedToken = normalizePaletteSearchValue(token);
  if (!normalizedToken) return [];
  const variants = new Set<string>([normalizedToken]);

  if (!/^[a-z]+$/.test(normalizedToken) || normalizedToken.length <= 2) {
    return Array.from(variants);
  }
  if (normalizedToken.endsWith('ies') && normalizedToken.length > 3) {
    variants.add(`${normalizedToken.slice(0, -3)}y`);
  } else if (normalizedToken.endsWith('s') && normalizedToken.length > 3) {
    variants.add(normalizedToken.slice(0, -1));
  } else {
    variants.add(`${normalizedToken}s`);
    if (normalizedToken.endsWith('y') && normalizedToken.length > 3) {
      variants.add(`${normalizedToken.slice(0, -1)}ies`);
    }
  }
  return Array.from(variants);
};

/** Whether every word of `query` prefixes some word of the item's searchable text. */
export const matchesDesignerPaletteQuery = (
  searchableText: string,
  query: string
): boolean => {
  const normalizedQuery = normalizePaletteSearchValue(query);
  if (!normalizedQuery) return true;
  const haystack = normalizePaletteSearchValue(searchableText);
  const haystackWords = haystack.split(' ').filter(Boolean);

  return normalizedQuery.split(' ').every((token) =>
    getTokenVariants(token).some((variant) =>
      haystackWords.some((word) => word.startsWith(variant))
    )
  );
};

export type DesignerPaletteSortableItem = {
  category: string;
  label: string;
  sortOrder?: number | null;
};

/**
 * Items by category, categories in `categoryOrder` first (then alphabetically), items by
 * `sortOrder` then label.
 */
export const groupDesignerPaletteItemsByCategory = <T extends DesignerPaletteSortableItem>(
  items: T[],
  categoryOrder: readonly string[] = []
): Record<string, T[]> => {
  const grouped = items.reduce<Record<string, T[]>>((acc, item) => {
    const category = item.category;
    acc[category] = acc[category] || [];
    acc[category].push(item);
    return acc;
  }, {});

  Object.values(grouped).forEach((categoryItems) => {
    categoryItems.sort((left, right) => {
      if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) {
        return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
      }
      return left.label.localeCompare(right.label);
    });
  });

  return Object.fromEntries(
    Object.entries(grouped).sort(([leftCategory], [rightCategory]) => {
      const leftIndex = categoryOrder.indexOf(leftCategory);
      const rightIndex = categoryOrder.indexOf(rightCategory);

      if (leftIndex !== -1 && rightIndex !== -1) {
        return leftIndex - rightIndex;
      }
      if (leftIndex !== -1) {
        return -1;
      }
      if (rightIndex !== -1) {
        return 1;
      }
      return leftCategory.localeCompare(rightCategory);
    })
  );
};
