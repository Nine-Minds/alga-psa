import { getSearchSynonyms } from './searchSynonyms';

const PALETTE_CATEGORY_ORDER = [
  'Actions',
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

// A query word matches an indexed word when they are the same word, a plural/singular variant,
// or synonyms (searchSynonyms.ts). Multi-word synonyms ("end user") match as phrases.
const getQueryTokenMatchers = (token: string): { words: Set<string>; phrases: string[] } => {
  const words = new Set<string>();
  const phrases: string[] = [];
  for (const variant of getTokenVariants(token)) {
    for (const synonym of getSearchSynonyms(variant)) {
      if (synonym.includes(' ')) {
        phrases.push(synonym);
      } else {
        getTokenVariants(synonym).forEach((synonymVariant) => words.add(synonymVariant));
      }
    }
  }
  return { words, phrases };
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
    .every((token) => {
      const { words, phrases } = getQueryTokenMatchers(token);
      return Array.from(words).some((word) => indexedTokens.has(word))
        || phrases.some((phrase) => searchIndex.includes(phrase));
    });
};

/** The parts of a palette item that search looks at, from most to least important. */
export type PaletteSearchFields = {
  /** The name shown on the tile. */
  label: string;
  /** Other names for the item: untranslated label, ids such as tickets.add_comment. */
  aliases?: Array<string | null | undefined>;
  /** Descriptions and the labels of actions a group contains. */
  description?: Array<string | null | undefined>;
  /** Input and output field names. Matched by exact word only (no synonyms), and ranked last. */
  keywords?: Array<string | null | undefined>;
};

const toWords = (values: Array<string | null | undefined>): Set<string> => {
  const words = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const word of normalizePaletteSearchValue(value).split(' ')) {
      if (word) words.add(word);
    }
  }
  return words;
};

const wordMatches = (token: string, words: Set<string>, options: { synonyms: boolean; prefix: boolean }): boolean => {
  const candidates = options.synonyms ? getQueryTokenMatchers(token).words : new Set(getTokenVariants(token));
  for (const candidate of candidates) {
    if (words.has(candidate)) return true;
  }
  if (options.prefix && token.length >= 2) {
    for (const word of words) {
      if (word.startsWith(token)) return true;
    }
  }
  return false;
};

/**
 * How well a palette item matches a search, or null when it doesn't match. Higher is better:
 * exact name, then a name that starts with or contains the search, then every word in the name,
 * then ids, synonyms and descriptions, and last field names. A synonym only counts on the name or
 * description, so a common field name can't drag unrelated actions into the results.
 */
export const scorePaletteSearchMatch = (fields: PaletteSearchFields, query: string): number | null => {
  const match = matchPaletteSearchTier(fields, query);
  return match ? match.tier + match.tieBreak : null;
};

/** The match tier (see scorePaletteSearchMatch) and, within it, the shorter-name tiebreak. */
const matchPaletteSearchTier = (
  fields: PaletteSearchFields,
  query: string
): { tier: number; tieBreak: number } | null => {
  const normalizedQuery = normalizePaletteSearchValue(query);
  if (!normalizedQuery) return { tier: 0, tieBreak: 0 };
  const tokens = normalizedQuery.split(' ');
  const label = normalizePaletteSearchValue(fields.label);
  const labelWords = toWords([fields.label]);
  // Shorter names win ties, so "Find Ticket" ranks above "Find Ticket Attachments".
  const tieBreak = -Math.min(labelWords.size, 20);
  const tier = scoreTier(fields, normalizedQuery, tokens, label, labelWords);
  return tier === null ? null : { tier, tieBreak: tier === 1000 ? 0 : tieBreak };
};

const scoreTier = (
  fields: PaletteSearchFields,
  normalizedQuery: string,
  tokens: string[],
  label: string,
  labelWords: Set<string>
): number | null => {
  if (label === normalizedQuery) return 1000;
  if (label.startsWith(normalizedQuery)) return 900;
  if (` ${label}`.includes(` ${normalizedQuery}`)) return 800;

  const isLast = (index: number) => index === tokens.length - 1;
  if (tokens.every((token, index) => wordMatches(token, labelWords, { synonyms: false, prefix: isLast(index) }))) {
    return 700;
  }
  const aliasWords = toWords([fields.label, ...(fields.aliases ?? [])]);
  if (tokens.every((token, index) => wordMatches(token, aliasWords, { synonyms: false, prefix: isLast(index) }))) {
    return 600;
  }
  if (tokens.every((token) => wordMatches(token, aliasWords, { synonyms: true, prefix: false }))) {
    return 500;
  }
  const describedWords = toWords([fields.label, ...(fields.aliases ?? []), ...(fields.description ?? [])]);
  if (tokens.every((token) => wordMatches(token, describedWords, { synonyms: true, prefix: false }))) {
    return 300;
  }
  const keywordWords = toWords(fields.keywords ?? []);
  if (tokens.every((token) =>
    wordMatches(token, describedWords, { synonyms: true, prefix: false }) ||
    wordMatches(token, keywordWords, { synonyms: false, prefix: false })
  )) {
    return 100;
  }
  return null;
};

type PaletteRankableItem = {
  searchFields: PaletteSearchFields;
  /** Palette tile kind of the item's group ('transform' for the generic data-shaping tiles). */
  tileKind?: string | null;
  category?: string | null;
};

/** Generic data-shaping tiles (Transform) lose ties to business actions that match as well. */
const isGenericTransformItem = (item: PaletteRankableItem): boolean =>
  item.tileKind === 'transform' || item.category === 'Transform';

/**
 * Items matching a search, best first: by match tier, then business actions before generic
 * transforms, then shorter names, then original order.
 */
export const rankPaletteSearchResults = <T extends PaletteRankableItem>(
  items: T[],
  query: string
): T[] =>
  items
    .map((item, index) => ({ item, index, match: matchPaletteSearchTier(item.searchFields, query) }))
    .filter((entry): entry is { item: T; index: number; match: { tier: number; tieBreak: number } } => entry.match !== null)
    .sort((left, right) =>
      right.match.tier - left.match.tier
      || Number(isGenericTransformItem(left.item)) - Number(isGenericTransformItem(right.item))
      || right.match.tieBreak - left.match.tieBreak
      || left.index - right.index
    )
    .map((entry) => entry.item);

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
