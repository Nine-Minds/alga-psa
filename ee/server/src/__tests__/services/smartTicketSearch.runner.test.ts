import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmartSearchEvent } from '@alga-psa/tickets/lib/smartTicketSearch/types';

const mocks = vi.hoisted(() => ({
  getAllMatchingTicketIds: vi.fn(),
  loadTicketListItemsByIds: vi.fn(),
  loadSmartSearchCandidates: vi.fn(),
  resolveTypeSafeClient: vi.fn(),
  systemOne: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getAllMatchingTicketIds: mocks.getAllMatchingTicketIds,
  loadTicketListItemsByIds: mocks.loadTicketListItemsByIds,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: mocks.loggerInfo, error: mocks.loggerError, warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/smartTicketSearch/loadSmartSearchCandidates', () => ({
  loadSmartSearchCandidates: mocks.loadSmartSearchCandidates,
}));

vi.mock('../../services/smartTicketSearch/typesafeClient', () => ({
  resolveTypeSafeClient: mocks.resolveTypeSafeClient,
}));

vi.mock('../../services/smartTicketSearch/smartSearchBudgets', async (importOriginal) => {
  const original = (await importOriginal()) as typeof import('../../services/smartTicketSearch/smartSearchBudgets');
  return {
    ...original,
    SMART_SEARCH_BUDGETS: {
      ...original.SMART_SEARCH_BUDGETS,
      maxTicketsPerRequest: 2,
      stateTokensPerRequest: 100_000,
      inflightPerSearch: 3,
      inflightPerProcess: 4,
      candidateLoadChunk: 4,
    },
  };
});

import { runSmartTicketSearch } from '../../services/smartTicketSearch/runSmartTicketSearch';

const user = { user_id: 'u1', tenant: 't1', user_type: 'internal' } as never;
const filters = { boardFilterState: 'active', searchQuery: 'ignored' } as never;

function candidatesFor(ids: string[]) {
  return ids.map((ticketId) => ({
    ticketId,
    ticketNumber: `T-${ticketId}`,
    title: ticketId,
    clientName: null,
    description: '',
    comments: [],
    approxTokens: 10,
  }));
}

/** systemOne fake: scores every candidate 0.9 for ids starting with "s", 0.1 otherwise. */
function answerFor(request: { state: { candidates: Array<{ ticket_number: string }> } }) {
  const answers: Record<string, unknown> = {};
  request.state.candidates.forEach((candidate, index) => {
    answers[`c${index}`] = { type: 'noul', noul: candidate.ticket_number.startsWith('T-s') ? 0.9 : 0.1 };
  });
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 0 } };
}

async function collect(signal = new AbortController().signal): Promise<SmartSearchEvent[]> {
  const events: SmartSearchEvent[] = [];
  for await (const event of runSmartTicketSearch({ tenant: 't1', user, filters, query: 'printer', signal })) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  for (const fn of Object.values(mocks) as Array<{ mockReset: () => void }>) {
    fn.mockReset();
  }
  mocks.resolveTypeSafeClient.mockResolvedValue({ systemOne: mocks.systemOne });
  mocks.loadSmartSearchCandidates.mockImplementation(async (_trx: unknown, _tenant: string, _user: unknown, ids: string[]) =>
    candidatesFor(ids)
  );
  mocks.loadTicketListItemsByIds.mockImplementation(async (_filters: unknown, ids: string[]) => ({
    tickets: ids.map((ticket_id) => ({ ticket_id, title: ticket_id })),
    metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} },
  }));
  mocks.systemOne.mockImplementation(async (request: never) => answerFor(request));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runSmartTicketSearch', () => {
  it('throws before the first event when no key is configured', async () => {
    mocks.resolveTypeSafeClient.mockResolvedValue(null);
    await expect(collect()).rejects.toMatchObject({ code: 'SMART_SEARCH_NOT_CONFIGURED' });
  });

  it('clears the keyword filter before enumerating the candidate set', async () => {
    mocks.getAllMatchingTicketIds.mockResolvedValue([]);
    const events = await collect();
    expect(mocks.getAllMatchingTicketIds).toHaveBeenCalledWith(expect.objectContaining({ searchQuery: '' }));
    expect(events.map((e) => e.type)).toEqual(['started', 'done']);
    expect(mocks.systemOne).not.toHaveBeenCalled();
  });

  it('streams scored rows with buckets, then a done event that sums usage', async () => {
    mocket(['s1', 'n1', 's2']);
    const events = await collect();

    expect(events[0]).toEqual({ type: 'started', searchId: expect.any(String), total: 3 });
    const scored = events.filter((e): e is Extract<SmartSearchEvent, { type: 'scored' }> => e.type === 'scored');
    const items = scored.flatMap((e) => e.items);
    expect(items.map((i) => [i.ticket.ticket_id, i.bucket])).toEqual(
      expect.arrayContaining([
        ['s1', 'strong'],
        ['n1', 'unlikely'],
        ['s2', 'strong'],
      ])
    );
    expect(items).toHaveLength(3);
    // Two batches (maxTicketsPerRequest = 2): running `scored` counts reach 3.
    expect(scored.at(-1)?.scored).toBe(3);

    const done = events.at(-1);
    expect(done).toEqual({
      type: 'done',
      total: 3,
      scored: 3,
      failed: 0,
      requests: 2,
      inputTokens: 200,
      model: 'jev-1.13.0',
      durationMs: expect.any(Number),
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      '[smart-ticket-search] completed',
      expect.objectContaining({ tenant: 't1', total: 3, scored: 3, inputTokens: 200, queryLength: 7 })
    );
  });

  it('reports a batch that fails after retries and keeps scoring the rest', async () => {
    mocket(['s1', 's2', 's3', 's4']);
    let calls = 0;
    mocks.systemOne.mockImplementation(async (request: never) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('overloaded');
        (error as { status?: number }).status = 529;
        throw error;
      }
      return answerFor(request);
    });

    const events = await collect();
    const failed = events.filter((e) => e.type === 'batch_failed');
    const scored = events.filter((e): e is Extract<SmartSearchEvent, { type: 'scored' }> => e.type === 'scored');
    expect(failed).toHaveLength(1);
    expect((failed[0] as { ticketIds: string[] }).ticketIds).toHaveLength(2);
    expect(scored.flatMap((e) => e.items)).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'done', total: 4, scored: 2, failed: 2, requests: 2 });
    expect(mocks.loggerError).toHaveBeenCalledWith('[smart-ticket-search] batch failed', expect.objectContaining({ error: expect.stringContaining('529') }));
  });

  it('reports tickets whose text could not be loaded as unscored', async () => {
    mocket(['s1', 'gone']);
    mocks.loadSmartSearchCandidates.mockImplementation(async (_t: unknown, _te: string, _u: unknown, ids: string[]) =>
      candidatesFor(ids.filter((id) => id !== 'gone'))
    );
    const events = await collect();
    const failed = events.find((e) => e.type === 'batch_failed') as { ticketIds: string[]; reason: string };
    expect(failed.ticketIds).toEqual(['gone']);
    expect(failed.reason).toMatch(/could not be loaded/);
    expect(events.at(-1)).toMatchObject({ type: 'done', scored: 1, failed: 1 });
  });

  it('never holds more than inflightPerSearch requests open', async () => {
    mocket(Array.from({ length: 12 }, (_, i) => `s${i}`)); // 6 batches of 2
    let inflight = 0;
    let peak = 0;
    mocks.systemOne.mockImplementation(async (request: never) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inflight -= 1;
      return answerFor(request);
    });
    const events = await collect();
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', scored: 12, requests: 6 });
  });

  it('caps requests across concurrent searches at inflightPerProcess', async () => {
    mocket(Array.from({ length: 12 }, (_, i) => `s${i}`));
    let inflight = 0;
    let peak = 0;
    mocks.systemOne.mockImplementation(async (request: never) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inflight -= 1;
      return answerFor(request);
    });
    await Promise.all([collect(), collect(), collect()]);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(3);
  });

  it('stops issuing requests once the signal aborts and ends without a done event', async () => {
    mocket(Array.from({ length: 12 }, (_, i) => `s${i}`));
    const controller = new AbortController();
    mocks.systemOne.mockImplementation(async (request: never) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return answerFor(request);
    });

    const events: SmartSearchEvent[] = [];
    for await (const event of runSmartTicketSearch({ tenant: 't1', user, filters, query: 'q', signal: controller.signal })) {
      events.push(event);
      if (event.type === 'scored') {
        controller.abort();
      }
    }
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(mocks.systemOne.mock.calls.length).toBeLessThan(6);
    expect(mocks.loggerInfo).not.toHaveBeenCalledWith('[smart-ticket-search] completed', expect.anything());
  });
});

function mocket(ids: string[]) {
  mocks.getAllMatchingTicketIds.mockResolvedValue(ids);
}
