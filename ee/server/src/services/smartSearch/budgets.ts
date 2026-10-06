/**
 * Every tunable that shapes how much text smart search sends to Jev and how
 * hard it drives the TypeSafe API. Numbers come from the limits documented at
 * docs.typesafe.ai/models on 2026-09-20 (jev-1.13.0: 1,200 requests/min and
 * 250k tokens/s account-wide; 32k tokens of state per request) and from the
 * jaggedness note that accuracy falls as state fills with unrelated detail.
 * They are constants so a tuning pass changes one file. The same budgets apply
 * to every entity: a candidate is a candidate whether it is a ticket or a project.
 */
export const SMART_SEARCH_BUDGETS = {
  /** Head facts + description + child rows for one candidate. */
  tokensPerCandidate: 3_000,
  /** The description is truncated to this before child rows fill the remainder. */
  descriptionMaxTokens: 1_200,
  /** Sum of candidate tokens packed into one TypeSafe request. */
  stateTokensPerRequest: 16_000,
  /** Hard ceiling on candidates per request, whatever their size. */
  maxCandidatesPerRequest: 10,
  /** Concurrent TypeSafe requests one search may hold open. */
  inflightPerSearch: 8,
  /** Concurrent TypeSafe requests the whole process may hold open, across searches. */
  inflightPerProcess: 16,
  /** Candidate ids loaded from the database per round trip while building state. */
  candidateLoadChunk: 200,
  /** Child rows (comments, tasks) fetched per candidate before budgeting; the budget keeps far fewer. */
  childRowsPerCandidateFetchLimit: 40,
} as const;

export interface PackingBudgets {
  stateTokensPerRequest: number;
  maxCandidatesPerRequest: number;
}

export interface CandidateBudgets {
  tokensPerCandidate: number;
  descriptionMaxTokens: number;
}

/** Bucket boundaries on the Noul probability. First guesses; tune on tenant data. */
export const SMART_SEARCH_BUCKETS = {
  strongMin: 0.75,
  possibleMin: 0.35,
} as const;

/**
 * A chars/4 estimate. Jev's tokenizer is not published; the hard 32k server
 * limit leaves several times this estimate in headroom at the budgets above.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Characters allowed for a token budget under the same estimate. */
export function charsForTokens(tokens: number): number {
  return tokens * 4;
}
