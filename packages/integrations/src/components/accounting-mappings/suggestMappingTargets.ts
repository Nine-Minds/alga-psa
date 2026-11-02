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
 *
 * Unavailable targets (option ids an existing mapping already holds) are
 * never suggested. They still take part in exact matching, after preferred-kind
 * narrowing: if that leaves only unavailable candidates the row is "blocked"
 * (its real match is taken) and gets no suggestion from any tier, fuzzy
 * included. If exactly one available candidate remains it is suggested; if
 * several remain the match is ambiguous as usual. Unavailable targets never
 * enter the fuzzy pool.
 *
 * Exclusive vs shareable (`isExclusiveTarget`): when several Alga rows exact-
 * match one target, an EXCLUSIVE target is ambiguous and suggested to none of
 * them (the unique index would reject all but one, and input order must not
 * pick the winner). A SHAREABLE target may be suggested to every matching row,
 * and stays in the fuzzy pool after an exact claim.
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
  /**
   * Option ids that existing mappings already hold. They are never suggested;
   * a row whose exact match is only unavailable targets gets no suggestion.
   */
  unavailableExternalIds?: ReadonlySet<string>;
  /**
   * Whether the server's unique index lets only ONE live mapping hold this
   * target. Derive it from the shared policy (isSharedMappingTarget); the engine
   * knows no provider. Omitted = every target is exclusive (conservative).
   */
  isExclusiveTarget?: (option: AccountingMappingEntityOption) => boolean;
};

export function suggestMappingTargets(
  algaEntities: AccountingMappingEntityOption[],
  externalEntities: AccountingMappingEntityOption[],
  options: SuggestOptions = {}
): Map<string, MappingSuggestion> {
  const preferredKind = options.preferredKind ?? FUZZY_KIND;
  const unavailable = options.unavailableExternalIds ?? new Set<string>();
  const isExclusiveTarget = options.isExclusiveTarget ?? (() => true);
  const result = new Map<string, MappingSuggestion>();
  const blocked = new Set<string>();

  const prepared = externalEntities.map((option) => ({
    option,
    code: normalizeCode(option.code),
    name: nameOf(option),
  }));

  /**
   * Unique candidate for an exact tier: preferred kind first, then others.
   * Kind narrowing happens before availability, so a taken preferred-kind
   * target is never silently swapped for a free target of another kind.
   * 'blocked' means candidates existed but all are unavailable.
   */
  function pickExact(
    matches: typeof prepared,
  ): { hit: typeof prepared[number] } | 'blocked' | null {
    if (matches.length === 0) return null;
    const preferred = matches.filter(
      (m) => !m.option.kind || m.option.kind === preferredKind
    );
    const pool = preferred.length > 0 ? preferred : matches;
    const available = pool.filter((m) => !unavailable.has(m.option.id));
    if (available.length === 0) return 'blocked';
    // Two equally good targets are ambiguous: leave the choice to the user.
    return available.length === 1 ? { hit: available[0] } : null;
  }

  // Pass 1: exact tiers for every row.
  for (const alga of algaEntities) {
    const code = normalizeCode(alga.code);
    if (code) {
      // Alga SKUs and non-item codes (e.g. Xero revenue-account codes) are
      // unrelated namespaces, so the code tier only considers the preferred
      // kind (or kind-less targets); other kinds match by exact name only.
      const picked = pickExact(
        prepared.filter(
          (p) =>
            p.code &&
            p.code === code &&
            (!p.option.kind || p.option.kind === preferredKind)
        )
      );
      if (picked === 'blocked') {
        // A code match is identity: its target is taken, so no other tier applies.
        blocked.add(alga.id);
        continue;
      }
      if (picked) {
        result.set(alga.id, {
          externalId: picked.hit.option.id,
          kind: picked.hit.option.kind,
          matchedBy: 'code',
        });
        continue;
      }
    }
    const name = nameOf(alga);
    if (name) {
      const picked = pickExact(prepared.filter((p) => p.name === name));
      if (picked === 'blocked') {
        blocked.add(alga.id);
      } else if (picked) {
        result.set(alga.id, {
          externalId: picked.hit.option.id,
          kind: picked.hit.option.kind,
          matchedBy: 'name',
        });
      }
    }
  }

  // Two Alga rows exact-matching the same target (e.g. duplicate service
  // names) would preselect one target twice and hit the unique index on save.
  // Treat those as ambiguous: suggest it for neither. The target stays
  // claimed so the fuzzy pass can't hand it to a third row either.
  const optionById = new Map(prepared.map((p) => [p.option.id, p.option]));
  const claimedByExact = new Map<string, string[]>();
  for (const [algaId, suggestion] of result) {
    claimedByExact.set(suggestion.externalId, [...(claimedByExact.get(suggestion.externalId) ?? []), algaId]);
  }
  // Only EXCLUSIVE targets are claimed: a shareable one can be handed to many
  // rows, and to the fuzzy pass.
  const exactClaims = new Set<string>();
  for (const [externalId, algaIds] of claimedByExact) {
    const option = optionById.get(externalId);
    if (option && !isExclusiveTarget(option)) continue;
    exactClaims.add(externalId);
    if (algaIds.length > 1) for (const id of algaIds) result.delete(id);
  }

  // Pass 2: fuzzy, item-kind (or kind-less) targets only, excluding anything an
  // exact match already claimed, and only when there is a single best target.
  const claimed = exactClaims;
  const fuzzyPool = prepared.filter(
    (p) => (!p.option.kind || p.option.kind === FUZZY_KIND) &&
      !claimed.has(p.option.id) &&
      !unavailable.has(p.option.id)
  );
  for (const alga of algaEntities) {
    if (result.has(alga.id) || blocked.has(alga.id)) continue;
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
