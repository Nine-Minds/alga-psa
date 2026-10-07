import type { AccountingMappingEntityOption } from './types';

/**
 * Name-based suggestions for the bulk mapping grid. Pure and provider-agnostic:
 * it only reads the structured `code` / `baseName` fields loaders attach to
 * options, never display strings, so no `Item · ` / `[Product] ` knowledge
 * lives here.
 *
 * Order (per Alga entity): exact code match (item/kind-less targets only), then exact normalised name, then
 * a conservative token-overlap match. Within a tier `item`-kind targets win;
 * an `account` target is only ever suggested from an EXACT tier (code or
 * name), never fuzzily — and kinds are never crossed silently: the suggestion
 * carries the kind of the option it matched.
 */

export type MappingSuggestion = {
  externalId: string;
  /** Kind of the matched option; undefined for modules without kinds. */
  kind?: string;
  matchedBy: 'code' | 'name' | 'fuzzy';
};

export const FUZZY_MATCH_THRESHOLD = 0.75;
/** Fuzzy matching needs enough tokens that overlap is meaningful. */
const FUZZY_MIN_TOKENS = 2;
const FUZZY_KIND = 'item';

export function normalizeMappingName(value: string | undefined | null): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCode(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

function tokens(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function nameOf(option: AccountingMappingEntityOption): string {
  return normalizeMappingName(option.baseName ?? option.name);
}

export type SuggestOptions = {
  /**
   * Kind preferred when a tier has candidates in several kinds. Defaults to
   * `item`. Other kinds are only suggested from exact tiers.
   */
  preferredKind?: string;
};

export function suggestMappingTargets(
  algaEntities: AccountingMappingEntityOption[],
  externalEntities: AccountingMappingEntityOption[],
  options: SuggestOptions = {}
): Map<string, MappingSuggestion> {
  const preferredKind = options.preferredKind ?? FUZZY_KIND;
  const result = new Map<string, MappingSuggestion>();

  const prepared = externalEntities.map((option) => ({
    option,
    code: normalizeCode(option.code),
    name: nameOf(option),
  }));

  /** Unique candidate for an exact tier: preferred kind first, then others. */
  function pickExact(
    matches: typeof prepared,
  ): typeof prepared[number] | null {
    if (matches.length === 0) return null;
    const preferred = matches.filter(
      (m) => !m.option.kind || m.option.kind === preferredKind
    );
    const pool = preferred.length > 0 ? preferred : matches;
    // Two equally good targets are ambiguous: leave the choice to the user.
    return pool.length === 1 ? pool[0] : null;
  }

  // Pass 1: exact tiers for every row.
  for (const alga of algaEntities) {
    const code = normalizeCode(alga.code);
    if (code) {
      // Alga SKUs and non-item codes (e.g. Xero revenue-account codes) are
      // unrelated namespaces, so the code tier only considers the preferred
      // kind (or kind-less targets); other kinds match by exact name only.
      const hit = pickExact(
        prepared.filter(
          (p) =>
            p.code &&
            p.code === code &&
            (!p.option.kind || p.option.kind === preferredKind)
        )
      );
      if (hit) {
        result.set(alga.id, {
          externalId: hit.option.id,
          kind: hit.option.kind,
          matchedBy: 'code',
        });
        continue;
      }
    }
    const name = nameOf(alga);
    if (name) {
      const hit = pickExact(prepared.filter((p) => p.name === name));
      if (hit) {
        result.set(alga.id, {
          externalId: hit.option.id,
          kind: hit.option.kind,
          matchedBy: 'name',
        });
      }
    }
  }

  // Pass 2: fuzzy, item-kind (or kind-less) targets only, excluding anything an
  // exact match already claimed, and only when there is a single best target.
  const claimed = new Set([...result.values()].map((s) => s.externalId));
  const fuzzyPool = prepared.filter(
    (p) => (!p.option.kind || p.option.kind === FUZZY_KIND) && !claimed.has(p.option.id)
  );
  for (const alga of algaEntities) {
    if (result.has(alga.id)) continue;
    const algaTokens = tokens(nameOf(alga));
    if (algaTokens.size < FUZZY_MIN_TOKENS) continue;

    let best = 0;
    let bestMatches: typeof prepared = [];
    for (const candidate of fuzzyPool) {
      const candidateTokens = tokens(candidate.name);
      if (candidateTokens.size < FUZZY_MIN_TOKENS) continue;
      const score = jaccard(algaTokens, candidateTokens);
      if (score > best) {
        best = score;
        bestMatches = [candidate];
      } else if (score === best && score > 0) {
        bestMatches.push(candidate);
      }
    }
    if (best >= FUZZY_MATCH_THRESHOLD && bestMatches.length === 1) {
      result.set(alga.id, {
        externalId: bestMatches[0].option.id,
        kind: bestMatches[0].option.kind,
        matchedBy: 'fuzzy',
      });
    }
  }

  return result;
}
