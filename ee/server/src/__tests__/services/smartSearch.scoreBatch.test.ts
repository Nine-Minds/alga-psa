import { describe, expect, it, vi } from 'vitest';

import { SMART_SEARCH_BUCKETS, SMART_SEARCH_BUDGETS } from '../../services/smartSearch/budgets';
import type { SmartSearchCandidate } from '../../services/smartSearch/candidate';
import {
  buildRelevanceRequest,
  bucketFor,
  packCandidateBatches,
  scoreBatch,
  type RelevancePrompt,
} from '../../services/smartSearch/scoreBatch';

function candidate(id: string, approxTokens: number): SmartSearchCandidate {
  return { id, state: { title: `Row ${id.slice(0, 1)}`, description: 'desc' }, approxTokens };
}

const prompt: RelevancePrompt = {
  question: (ref, index) => `Is \`${ref}\` (\`candidates[${index}]\`) about \`query\`?`,
  criteria: { true: 'yes when about it', false: 'no when not' },
};

describe('packCandidateBatches', () => {
  it('closes a batch at the token budget and preserves input order', () => {
    const batches = packCandidateBatches(
      [candidate('a', 6000), candidate('b', 6000), candidate('c', 6000), candidate('d', 100)],
      { stateTokensPerRequest: 12_000, maxCandidatesPerRequest: 10 }
    );
    expect(batches.map((b) => b.map((c) => c.id))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('closes a batch at the candidate ceiling regardless of size', () => {
    const many = Array.from({ length: 23 }, (_, i) => candidate(String(i), 10));
    const batches = packCandidateBatches(many, { stateTokensPerRequest: 100_000, maxCandidatesPerRequest: 10 });
    expect(batches.map((b) => b.length)).toEqual([10, 10, 3]);
  });

  it('gives an oversized candidate its own batch rather than dropping it', () => {
    const batches = packCandidateBatches(
      [candidate('a', 100), candidate('big', 50_000), candidate('c', 100)],
      { stateTokensPerRequest: 16_000, maxCandidatesPerRequest: 10 }
    );
    expect(batches.map((b) => b.map((c) => c.id))).toEqual([['a'], ['big'], ['c']]);
  });

  it('uses the production budgets by default', () => {
    const many = Array.from({ length: SMART_SEARCH_BUDGETS.maxCandidatesPerRequest + 1 }, (_, i) => candidate(String(i), 1));
    expect(packCandidateBatches(many)).toHaveLength(2);
  });
});

describe('buildRelevanceRequest', () => {
  it('asks one noul per candidate, keyed c{i}, with the entity prompt and criteria', () => {
    const request = buildRelevanceRequest(prompt, 'printer offline', [candidate('a', 1), candidate('b', 1)]);
    expect(Object.keys(request.questions)).toEqual(['c0', 'c1']);
    expect(request.questions.c1).toEqual({
      type: 'noul',
      instructions: { question: 'Is `c1` (`candidates[1]`) about `query`?' },
      criteria: { true: 'yes when about it', false: 'no when not' },
    });
    expect(request.state.query).toBe('printer offline');
    // Each candidate carries its ref first, so the question has a second anchor besides the index.
    expect(request.state.candidates).toEqual([
      { ref: 'c0', title: 'Row a', description: 'desc' },
      { ref: 'c1', title: 'Row b', description: 'desc' },
    ]);
    expect(Object.keys(request.state.candidates[0])[0]).toBe('ref');
  });

  it('never leaks ids or token estimates into the state', () => {
    const request = buildRelevanceRequest(prompt, 'q', [candidate('9f1d-uuid-secret', 123)]);
    const serialized = JSON.stringify(request.state);
    expect(serialized).not.toContain('9f1d-uuid-secret');
    expect(serialized).not.toContain('approxTokens');
  });
});

describe('bucketFor', () => {
  it('splits at the configured thresholds, inclusive at the lower bound', () => {
    expect(bucketFor(SMART_SEARCH_BUCKETS.strongMin)).toBe('strong');
    expect(bucketFor(SMART_SEARCH_BUCKETS.strongMin - 0.001)).toBe('possible');
    expect(bucketFor(SMART_SEARCH_BUCKETS.possibleMin)).toBe('possible');
    expect(bucketFor(SMART_SEARCH_BUCKETS.possibleMin - 0.001)).toBe('unlikely');
    expect(bucketFor(0)).toBe('unlikely');
    expect(bucketFor(1)).toBe('strong');
  });
});

describe('scoreBatch', () => {
  it('maps answers back to ids in batch order and reports usage', async () => {
    const systemOne = vi.fn().mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        c0: { type: 'noul', noul: 0.9 },
        c1: { type: 'noul', noul: 0.2 },
      },
      usage: { input_tokens: 321, output_tokens: 0 },
    });
    const signal = new AbortController().signal;
    const result = await scoreBatch({ systemOne } as never, prompt, 'q', [candidate('a', 1), candidate('b', 1)], signal);

    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne.mock.calls[0][1]).toEqual({ signal });
    expect(result).toEqual({
      scores: [
        { id: 'a', score: 0.9, bucket: 'strong' },
        { id: 'b', score: 0.2, bucket: 'unlikely' },
      ],
      inputTokens: 321,
      model: 'jev-1.13.0',
    });
  });

  it('fails fast when an answer is missing', async () => {
    const systemOne = vi.fn().mockResolvedValue({
      model: 'jev-1.13.0',
      answers: { c0: { type: 'noul', noul: 0.5 } },
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(
      scoreBatch({ systemOne } as never, prompt, 'q', [candidate('a', 1), candidate('b', 1)], new AbortController().signal)
    ).rejects.toThrow(/c1 missing/);
  });
});
