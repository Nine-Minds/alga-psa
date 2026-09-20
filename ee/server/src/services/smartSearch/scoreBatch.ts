/**
 * Packs candidates into TypeSafe requests and asks one relevance question per
 * candidate. Jev evaluates every question in a request against the same state
 * in parallel, so a request carrying ten candidates costs one round trip.
 *
 * The question is one narrow Noul, phrased by the entity so a high value means
 * "yes, about the same thing", with criteria that spell out the boundary cases
 * Jev reads literally. Question ids (`c0`, `c1`, …) are for code and never
 * reach the model.
 */

import type { NoulQuestion, SystemOneRequest, TypeSafeClient } from '@typesafe-ai/sdk';

import type { SmartSearchBucket } from '@alga-psa/ui/lib/smartSearch/types';

import { SMART_SEARCH_BUCKETS, SMART_SEARCH_BUDGETS, type PackingBudgets } from './budgets';
import type { JsonObject, SmartSearchCandidate } from './candidate';

/**
 * How an entity phrases the relevance question. `question` receives the
 * candidate's `ref` (`c0`, `c1`, …) and its index and must name both: each
 * candidate in the state carries `ref` as its first field, because with large
 * candidates Jev's reading of `candidates[i]` alone drifts to a neighbour
 * (verified on the dev tenant's projects: an empty project scored 77% until
 * the ref anchored the question).
 */
export interface RelevancePrompt {
  question: (ref: string, index: number) => string;
  criteria: { true: string; false: string };
}

export type RelevanceQuestions = Record<string, NoulQuestion>;

// Type aliases, not interfaces: the SDK's `state` is a JSON value type with an
// index signature, and only object *type literals* are assignable to that.
export type RelevanceState = { query: string; candidates: JsonObject[] };

export type RelevanceRequest = SystemOneRequest<RelevanceQuestions> & { state: RelevanceState };

export function packCandidateBatches(
  candidates: SmartSearchCandidate[],
  budgets: PackingBudgets = SMART_SEARCH_BUDGETS
): SmartSearchCandidate[][] {
  const batches: SmartSearchCandidate[][] = [];
  let current: SmartSearchCandidate[] = [];
  let currentTokens = 0;

  for (const candidate of candidates) {
    const wouldOverflow =
      current.length > 0 &&
      (current.length >= budgets.maxCandidatesPerRequest ||
        currentTokens + candidate.approxTokens > budgets.stateTokensPerRequest);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(candidate);
    currentTokens += candidate.approxTokens;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

export function candidateRef(index: number): string {
  return `c${index}`;
}

export function relevanceQuestion(prompt: RelevancePrompt, index: number): NoulQuestion {
  return {
    type: 'noul',
    instructions: { question: prompt.question(candidateRef(index), index) },
    criteria: { ...prompt.criteria },
  };
}

export function buildRelevanceRequest(
  prompt: RelevancePrompt,
  query: string,
  batch: SmartSearchCandidate[]
): RelevanceRequest {
  const questions: RelevanceQuestions = {};
  batch.forEach((_, index) => {
    questions[candidateRef(index)] = relevanceQuestion(prompt, index);
  });
  return {
    state: {
      query,
      candidates: batch.map((candidate, index) => ({ ref: candidateRef(index), ...candidate.state })),
    },
    questions,
  };
}

export function bucketFor(score: number): SmartSearchBucket {
  if (score >= SMART_SEARCH_BUCKETS.strongMin) {
    return 'strong';
  }
  if (score >= SMART_SEARCH_BUCKETS.possibleMin) {
    return 'possible';
  }
  return 'unlikely';
}

export interface BatchScore {
  id: string;
  score: number;
  bucket: SmartSearchBucket;
}

export interface ScoredBatch {
  scores: BatchScore[];
  inputTokens: number;
  model: string;
}

/**
 * One TypeSafe round trip for one batch. Errors propagate; the runner decides
 * whether a failed batch ends the search (it does not) or is reported.
 */
export async function scoreBatch(
  client: Pick<TypeSafeClient, 'systemOne'>,
  prompt: RelevancePrompt,
  query: string,
  batch: SmartSearchCandidate[],
  signal: AbortSignal
): Promise<ScoredBatch> {
  const request = buildRelevanceRequest(prompt, query, batch);
  const result = await client.systemOne(request, { signal });
  const scores: BatchScore[] = batch.map((candidate, index) => {
    const ref = candidateRef(index);
    const answer = result.answers[ref];
    if (!answer || answer.type !== 'noul' || typeof answer.noul !== 'number') {
      throw new Error(`TypeSafe answer for ${ref} missing or not a noul (candidate ${candidate.id})`);
    }
    const score = Math.min(1, Math.max(0, answer.noul));
    return { id: candidate.id, score, bucket: bucketFor(score) };
  });
  return {
    scores,
    inputTokens: result.usage?.input_tokens ?? 0,
    model: result.model,
  };
}
