const PALETTE_CATEGORY_ORDER = [
  'Control',
  'Core',
  'Transform',
  'Apps',
  'Email',
  'Nodes',
];

const normalizePaletteSearchValue = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const getTokenVariants = (token: string): string[] => {
  const variants = new Set<string>();
  const normalizedToken = normalizePaletteSearchValue(token);
  if (!normalizedToken) return [];

  variants.add(normalizedToken);

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

export const buildPaletteSearchIndex = (values: Array<string | null | undefined>): string => {
  const terms = new Set<string>();

  for (const value of values) {
    if (!value) continue;
    const normalizedValue = normalizePaletteSearchValue(value);
    if (!normalizedValue) continue;

    terms.add(normalizedValue);
    for (const token of normalizedValue.split(' ')) {
      for (const variant of getTokenVariants(token)) {
        terms.add(variant);
      }
    }
  }

  return Array.from(terms).join(' ');
};

export const matchesPaletteSearchQuery = (searchIndex: string, query: string): boolean => {
  const normalizedQuery = normalizePaletteSearchValue(query);
  if (!normalizedQuery) return true;

  if (searchIndex.includes(normalizedQuery)) {
    return true;
  }

  const indexedTokens = new Set(searchIndex.split(' ').filter(Boolean));
  return normalizedQuery
    .split(' ')
    .filter(Boolean)
    .every((token) => getTokenVariants(token).some((variant) => indexedTokens.has(variant)));
};

type PaletteSortableItem = {
  category: string;
  label: string;
  sortOrder?: number | null;
};

export const groupPaletteItemsByCategory = <T extends PaletteSortableItem>(
  items: T[]
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
      const leftIndex = PALETTE_CATEGORY_ORDER.indexOf(leftCategory);
      const rightIndex = PALETTE_CATEGORY_ORDER.indexOf(rightCategory);

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
