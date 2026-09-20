/**
 * Packs candidates into TypeSafe requests and asks one relevance question per
 * candidate. Jev evaluates every question in a request against the same state
 * in parallel, so a request carrying ten tickets costs one round trip.
 *
 * The question is one narrow Noul, phrased so a high value means "yes, about
 * the same thing", with criteria that spell out the boundary cases Jev reads
 * literally. Question ids (`c0`, `c1`, …) are for code and never reach the model.
 */

import type { NoulQuestion, SystemOneRequest, TypeSafeClient } from '@typesafe-ai/sdk';

import type { SmartSearchBucket } from '@alga-psa/tickets/lib/smartTicketSearch/types';

import type { SmartSearchCandidate } from './loadSmartSearchCandidates';
import { SMART_SEARCH_BUCKETS, SMART_SEARCH_BUDGETS } from './smartSearchBudgets';

// Type aliases, not interfaces: the SDK's `state` is a JSON value type with an
// index signature, and only object *type literals* are assignable to that.
export type CandidateState = {
  ticket_number: string;
  title: string;
  client: string | null;
  description: string;
  /** Newest first. */
  comments: Array<{ author: string; text: string }>;
};

export type RelevanceQuestions = Record<string, NoulQuestion>;

export type RelevanceState = { query: string; candidates: CandidateState[] };

export type RelevanceRequest = SystemOneRequest<RelevanceQuestions> & { state: RelevanceState };

export interface PackingBudgets {
  stateTokensPerRequest: number;
  maxTicketsPerRequest: number;
}

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
      (current.length >= budgets.maxTicketsPerRequest ||
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

export function toCandidateState(candidate: SmartSearchCandidate): CandidateState {
  return {
    ticket_number: candidate.ticketNumber,
    title: candidate.title,
    client: candidate.clientName,
    description: candidate.description,
    comments: candidate.comments.map((comment) => ({ author: comment.author, text: comment.text })),
  };
}

export const RELEVANCE_CRITERIA = {
  true:
    'The ticket concerns what the query describes, even when it uses different words, ' +
    'names a specific product or vendor where the query names a category, or describes ' +
    'a symptom of the same underlying problem.',
  false:
    'The ticket is about a different problem, request, or subject. Sharing a client, a ' +
    'technician, a device type, or a few incidental words does not make it relevant.',
} as const;

export function relevanceQuestion(index: number): NoulQuestion {
  return {
    type: 'noul',
    instructions: {
      question:
        `Is the support ticket at \`candidates[${index}]\` about the problem, request, ` +
        'person, device, or subject described by `query`?',
    },
    criteria: { ...RELEVANCE_CRITERIA },
  };
}

export function buildRelevanceRequest(query: string, batch: SmartSearchCandidate[]): RelevanceRequest {
  const questions: RelevanceQuestions = {};
  batch.forEach((_, index) => {
    questions[`c${index}`] = relevanceQuestion(index);
  });
  return {
    state: { query, candidates: batch.map(toCandidateState) },
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
  ticketId: string;
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
  query: string,
  batch: SmartSearchCandidate[],
  signal: AbortSignal
): Promise<ScoredBatch> {
  const request = buildRelevanceRequest(query, batch);
  const result = await client.systemOne(request, { signal });
  const scores: BatchScore[] = batch.map((candidate, index) => {
    const answer = result.answers[`c${index}`];
    if (!answer || answer.type !== 'noul' || typeof answer.noul !== 'number') {
      throw new Error(`TypeSafe answer for c${index} missing or not a noul (ticket ${candidate.ticketId})`);
    }
    const score = Math.min(1, Math.max(0, answer.noul));
    return { ticketId: candidate.ticketId, score, bucket: bucketFor(score) };
  });
  return {
    scores,
    inputTokens: result.usage?.input_tokens ?? 0,
    model: result.model,
  };
}
