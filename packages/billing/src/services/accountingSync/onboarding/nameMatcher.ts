/**
 * Pure name-matching utilities for the QBO onboarding wizard.
 * No I/O: all functions are deterministic transforms / comparisons.
 */

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited',
  'corp', 'corporation', 'co', 'company', 'gmbh', 'plc'
]);

// Punctuation to strip entirely (no space replacement): ' (apostrophe)
const APOSTROPHE_RE = /'/g;
// Punctuation to replace with space: . , & - ( )
const PUNCT_SPACE_RE = /[.,&\-()\s]+/g;

/**
 * Normalise a business name for comparison:
 *   1. lowercase + trim
 *   2. strip apostrophes (no space), replace other punctuation (.,&-()) with space
 *   3. collapse whitespace
 *   4. strip trailing legal-suffix whole-words (may repeat; strip even if only word)
 */
export function normalizeBusinessName(name: string): string {
  let s = name.toLowerCase().trim();
  // Strip apostrophes without inserting a space
  s = s.replace(APOSTROPHE_RE, '');
  // Replace remaining punctuation and runs of whitespace with a single space
  s = s.replace(PUNCT_SPACE_RE, ' ').trim();

  // Strip trailing legal suffixes (whole words, may repeat)
  // Allow stripping even when the suffix is the only word
  let changed = true;
  while (changed) {
    changed = false;
    const words = s.split(' ').filter(Boolean);
    if (words.length > 0 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
      words.pop();
      s = words.join(' ');
      changed = true;
    }
  }

  return s;
}

// ─── Jaccard token overlap ────────────────────────────────────────────────────

function tokenize(normalizedName: string): Set<string> {
  return new Set(normalizedName.split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Public match API ─────────────────────────────────────────────────────────

export interface MatchClient {
  id: string;
  name: string;
}

export interface MatchCustomer {
  id: string;
  name: string;
  active: boolean;
}

export interface ExactMatch {
  clientId: string;
  externalId: string;
  externalName: string;
}

export interface SuggestionMatch {
  clientId: string;
  externalId: string;
  externalName: string;
  score: number;
}

export interface MatchResult {
  exact: ExactMatch[];
  suggestions: SuggestionMatch[];
}

const SUGGESTION_THRESHOLD = 0.5;
const MAX_SUGGESTIONS_PER_CLIENT = 3;

/**
 * Match Alga clients to active QBO customers.
 *
 * Exact match = normalised equality (only active customers).
 * On collision (two clients → same customer) neither gets an exact match;
 * both are downgraded to suggestions.
 *
 * Suggestions = Jaccard ≥ 0.5 (not already exact), max 3 per client,
 * sorted by score desc.
 */
export function matchCustomers(
  clients: MatchClient[],
  customers: MatchCustomer[]
): MatchResult {
  const activeCustomers = customers.filter((c) => c.active);

  // Pre-normalise everything
  const normClient = new Map<string, string>(clients.map((c) => [c.id, normalizeBusinessName(c.name)]));
  const normCustomer = new Map<string, string>(activeCustomers.map((c) => [c.id, normalizeBusinessName(c.name)]));

  // Build exact candidates: normalised_client_name → { clientId, customer[] }
  // We need to detect collisions where multiple clients map to the same customer.
  const exactByCustomer = new Map<string, string[]>(); // externalId → [clientId, ...]

  for (const client of clients) {
    const cn = normClient.get(client.id)!;
    for (const customer of activeCustomers) {
      const en = normCustomer.get(customer.id)!;
      if (cn === en) {
        const arr = exactByCustomer.get(customer.id) ?? [];
        arr.push(client.id);
        exactByCustomer.set(customer.id, arr);
      }
    }
  }

  // Customers with exactly one client match → exact. Others → downgraded.
  const exactMatchSet = new Set<string>(); // clientIds that have a clean exact match
  const exact: ExactMatch[] = [];

  for (const [externalId, clientIds] of exactByCustomer.entries()) {
    if (clientIds.length === 1) {
      const customer = activeCustomers.find((c) => c.id === externalId)!;
      exact.push({ clientId: clientIds[0], externalId, externalName: customer.name });
      exactMatchSet.add(clientIds[0]);
    }
    // if > 1: leave them for suggestions
  }

  // Suggestions: Jaccard ≥ 0.5, not already in exact, max 3 per client
  const suggestions: SuggestionMatch[] = [];

  for (const client of clients) {
    if (exactMatchSet.has(client.id)) continue;

    const cn = normClient.get(client.id)!;
    const clientTokens = tokenize(cn);

    const scored: { externalId: string; externalName: string; score: number }[] = [];

    for (const customer of activeCustomers) {
      const en = normCustomer.get(customer.id)!;
      if (en === cn) {
        // exact-by-normalized but not clean → treat as suggestion with score 1
        scored.push({ externalId: customer.id, externalName: customer.name, score: 1 });
        continue;
      }
      const custTokens = tokenize(en);
      const score = jaccard(clientTokens, custTokens);
      if (score >= SUGGESTION_THRESHOLD) {
        scored.push({ externalId: customer.id, externalName: customer.name, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, MAX_SUGGESTIONS_PER_CLIENT)) {
      suggestions.push({ clientId: client.id, ...s });
    }
  }

  return { exact, suggestions };
}
