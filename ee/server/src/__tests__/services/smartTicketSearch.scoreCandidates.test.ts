import { describe, expect, it, vi } from 'vitest';

import type { SmartSearchCandidate } from '../../services/smartTicketSearch/loadSmartSearchCandidates';
import {
  buildRelevanceRequest,
  bucketFor,
  packCandidateBatches,
  scoreBatch,
} from '../../services/smartTicketSearch/scoreCandidates';
import { SMART_SEARCH_BUCKETS, SMART_SEARCH_BUDGETS } from '../../services/smartTicketSearch/smartSearchBudgets';

function candidate(id: string, approxTokens: number): SmartSearchCandidate {
  return {
    ticketId: id,
    ticketNumber: `T-${id}`,
    title: `Ticket ${id}`,
    clientName: 'Acme',
    facts: {
      status: 'Open',
      isClosed: false,
      priority: 'High',
      board: 'Support',
      assignedTo: 'Sam Tech',
      assignedTeam: null,
      enteredAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      closedAt: null,
      dueDate: null,
    },
    description: 'desc',
    comments: [{ author: 'technician', text: 'hello' }],
    approxTokens,
  };
}

describe('packCandidateBatches', () => {
  it('closes a batch at the token budget and preserves input order', () => {
    const batches = packCandidateBatches(
      [candidate('a', 6000), candidate('b', 6000), candidate('c', 6000), candidate('d', 100)],
      { stateTokensPerRequest: 12_000, maxTicketsPerRequest: 10 }
    );
    expect(batches.map((b) => b.map((c) => c.ticketId))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('closes a batch at the ticket ceiling regardless of size', () => {
    const many = Array.from({ length: 23 }, (_, i) => candidate(String(i), 10));
    const batches = packCandidateBatches(many, { stateTokensPerRequest: 100_000, maxTicketsPerRequest: 10 });
    expect(batches.map((b) => b.length)).toEqual([10, 10, 3]);
  });

  it('gives an oversized candidate its own batch rather than dropping it', () => {
    const batches = packCandidateBatches(
      [candidate('a', 100), candidate('big', 50_000), candidate('c', 100)],
      { stateTokensPerRequest: 16_000, maxTicketsPerRequest: 10 }
    );
    expect(batches.map((b) => b.map((c) => c.ticketId))).toEqual([['a'], ['big'], ['c']]);
  });

  it('uses the production budgets by default', () => {
    const many = Array.from({ length: SMART_SEARCH_BUDGETS.maxTicketsPerRequest + 1 }, (_, i) => candidate(String(i), 1));
    expect(packCandidateBatches(many)).toHaveLength(2);
  });
});

describe('buildRelevanceRequest', () => {
  it('asks one noul per candidate, keyed c{i}, pointing at candidates[i] and query', () => {
    const request = buildRelevanceRequest('printer offline', [candidate('a', 1), candidate('b', 1)]);
    expect(Object.keys(request.questions)).toEqual(['c0', 'c1']);
    expect(request.questions.c1.type).toBe('noul');
    expect(JSON.stringify(request.questions.c1.instructions)).toContain('`candidates[1]`');
    expect(JSON.stringify(request.questions.c1.instructions)).toContain('`query`');
    expect(request.questions.c1.criteria?.true).toBeTruthy();
    expect(request.questions.c1.criteria?.false).toBeTruthy();
    expect(request.state.query).toBe('printer offline');
    expect(request.state.candidates).toHaveLength(2);
  });

  it('never leaks ticket ids or token estimates into the state', () => {
    const request = buildRelevanceRequest('q', [{ ...candidate('a', 123), ticketId: '9f1d-uuid-secret' }]);
    const serialized = JSON.stringify(request.state);
    expect(serialized).not.toContain('9f1d-uuid-secret');
    expect(serialized).not.toContain('approxTokens');
    expect(request.state.candidates[0]).toEqual({
      ticket_number: 'T-a',
      title: 'Ticket a',
      client: 'Acme',
      status: 'Open',
      is_closed: false,
      priority: 'High',
      board: 'Support',
      assigned_to: 'Sam Tech',
      assigned_team: null,
      entered_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-02T10:00:00.000Z',
      closed_at: null,
      due_date: null,
      description: 'desc',
      comments: [{ author: 'technician', text: 'hello' }],
    });
  });

  it('names the ticket facts in the question so a literal reader knows when to use them', () => {
    const request = buildRelevanceRequest('q', [candidate('a', 1)]);
    const question = JSON.stringify(request.questions.c0.instructions);
    for (const field of ['status', 'is_closed', 'priority', 'board', 'assigned_to', 'assigned_team', 'due_date', 'closed_at']) {
      expect(question).toContain(field);
    }
    expect(question).toContain('only when `query` refers to such things');
    expect(JSON.stringify(request.questions.c0.criteria?.false)).toContain('does not\nmatch'.replace('\n', ' '));
  });

  it('keeps the question wording stable', () => {
    const request = buildRelevanceRequest('q', [candidate('a', 1)]);
    expect(request.questions.c0).toMatchInlineSnapshot(`
      {
        "criteria": {
          "false": "The ticket is about a different problem, request, or subject, or the query names a status, closed state, priority, board, assignee, team, or time that the ticket does not match. Sharing a client, a technician, a device type, or a few incidental words the query does not ask about does not make it relevant.",
          "true": "The ticket concerns what the query describes, even when it uses different words, names a specific product or vendor where the query names a category, or describes a symptom of the same underlying problem. When the query mentions a status, whether the ticket is closed, a priority, a board, an assignee or team, or a time such as a due date or when it was opened, updated, or closed, the ticket matches on those too.",
        },
        "instructions": {
          "question": "Is the support ticket at \`candidates[0]\` about the problem, request, person, device, or subject described by \`query\`? The candidate carries its current status, is_closed flag, priority, board, assigned_to, assigned_team, and entered_at, updated_at, closed_at, and due_date as ISO 8601 date-times; use them only when \`query\` refers to such things.",
        },
        "type": "noul",
      }
    `);
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
  it('maps answers back to ticket ids in batch order and reports usage', async () => {
    const systemOne = vi.fn().mockResolvedValue({
      model: 'jev-1.13.0',
      answers: {
        c0: { type: 'noul', noul: 0.9 },
        c1: { type: 'noul', noul: 0.2 },
      },
      usage: { input_tokens: 321, output_tokens: 0 },
    });
    const signal = new AbortController().signal;
    const result = await scoreBatch({ systemOne } as never, 'q', [candidate('a', 1), candidate('b', 1)], signal);

    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne.mock.calls[0][1]).toEqual({ signal });
    expect(result).toEqual({
      scores: [
        { ticketId: 'a', score: 0.9, bucket: 'strong' },
        { ticketId: 'b', score: 0.2, bucket: 'unlikely' },
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
      scoreBatch({ systemOne } as never, 'q', [candidate('a', 1), candidate('b', 1)], new AbortController().signal)
    ).rejects.toThrow(/c1 missing/);
  });
});
