import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmartSearchEvent } from '@alga-psa/ui/lib/smartSearch/types';

const mocks = vi.hoisted(() => ({
  enumerate: vi.fn(),
  loadCandidates: vi.fn(),
  hydrateRows: vi.fn(),
  resolveTypeSafeClient: vi.fn(),
  systemOne: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: mocks.loggerInfo, error: mocks.loggerError, warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/smartSearch/typesafeClient', () => ({
  resolveTypeSafeClient: mocks.resolveTypeSafeClient,
}));

vi.mock('../../services/smartSearch/budgets', async (importOriginal) => {
  const original = (await importOriginal()) as typeof import('../../services/smartSearch/budgets');
  return {
    ...original,
    SMART_SEARCH_BUDGETS: {
      ...original.SMART_SEARCH_BUDGETS,
      maxCandidatesPerRequest: 2,
      stateTokensPerRequest: 100_000,
      inflightPerSearch: 3,
      inflightPerProcess: 4,
      candidateLoadChunk: 4,
    },
  };
});

import type { SmartSearchEntityDefinition } from '../../services/smartSearch/entityDefinition';
import { runSmartSearch } from '../../services/smartSearch/runSmartSearch';

type Row = { widget_id: string; title: string };
type Scope = { keyword: string; chips: string[] };
type Metadata = { tags: Record<string, string[]> };
type Event = SmartSearchEvent<Row, Metadata>;

const user = { user_id: 'u1', tenant: 't1', user_type: 'internal' } as never;
const scope: Scope = { keyword: 'ignored', chips: ['open'] };

const definition: SmartSearchEntityDefinition<Scope, Row, Metadata> = {
  entity: 'ticket',
  permissionResource: 'ticket',
  noun: 'widgets',
  scopeSchema: {} as never,
  normalizeScope: (s) => ({ ...s, keyword: '' }),
  enumerate: mocks.enumerate,
  loadCandidates: mocks.loadCandidates,
  hydrateRows: mocks.hydrateRows,
  rowId: (row) => row.widget_id,
  relevance: { question: (ref) => `q-${ref}`, criteria: { true: 't', false: 'f' } },
};

function candidatesFor(ids: string[]) {
  return ids.map((id) => ({ id, state: { number: `W-${id}` }, approxTokens: 10 }));
}

/** systemOne fake: scores every candidate 0.9 for ids starting with "s", 0.1 otherwise. */
function answerFor(request: { state: { candidates: Array<{ number: string }> } }) {
  const answers: Record<string, unknown> = {};
  request.state.candidates.forEach((candidate, index) => {
    answers[`c${index}`] = { type: 'noul', noul: candidate.number.startsWith('W-s') ? 0.9 : 0.1 };
  });
  return { model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 0 } };
}

async function collect(signal = new AbortController().signal, query = 'printer'): Promise<Event[]> {
  const events: Event[] = [];
  for await (const event of runSmartSearch({ definition, tenant: 't1', user, scope, query, signal })) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  for (const fn of Object.values(mocks) as Array<{ mockReset: () => void }>) {
    fn.mockReset();
  }
  mocks.resolveTypeSafeClient.mockResolvedValue({ systemOne: mocks.systemOne });
  mocks.loadCandidates.mockImplementation(async (_trx: unknown, _tenant: string, _user: unknown, ids: string[]) => candidatesFor(ids));
  mocks.hydrateRows.mockImplementation(async (_scope: unknown, ids: string[]) => ({
    rows: ids.map((widget_id) => ({ widget_id, title: widget_id })),
    metadata: { tags: {} },
  }));
  mocks.systemOne.mockImplementation(async (request: never) => answerFor(request));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runSmartSearch', () => {
  it('throws before the first event when no key is configured', async () => {
    mocks.resolveTypeSafeClient.mockResolvedValue(null);
    await expect(collect()).rejects.toMatchObject({ code: 'SMART_SEARCH_NOT_CONFIGURED' });
  });

  it('normalizes the scope through the definition before enumerating', async () => {
    mocks.enumerate.mockResolvedValue([]);
    const events = await collect();
    expect(mocks.enumerate).toHaveBeenCalledWith({ keyword: '', chips: ['open'] });
    expect(events.map((e) => e.type)).toEqual(['started', 'done']);
    expect(mocks.systemOne).not.toHaveBeenCalled();
  });

  it('turns a permission failure from enumerate into FORBIDDEN before the first event', async () => {
    mocks.enumerate.mockResolvedValue({ permissionError: 'Permission denied: nope' });
    await expect(collect()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('streams scored rows with buckets, then a done event that sums usage', async () => {
    mocks.enumerate.mockResolvedValue(['s1', 'n1', 's2']);
    const events = await collect();

    expect(events[0]).toEqual({ type: 'started', searchId: expect.any(String), total: 3 });
    const scored = events.filter((e): e is Extract<Event, { type: 'scored' }> => e.type === 'scored');
    const items = scored.flatMap((e) => e.items);
    expect(items.map((i) => [i.row.widget_id, i.bucket])).toEqual(
      expect.arrayContaining([
        ['s1', 'strong'],
        ['n1', 'unlikely'],
        ['s2', 'strong'],
      ])
    );
    expect(items).toHaveLength(3);
    expect(scored.at(-1)?.scored).toBe(3);
    // Rows are hydrated through the definition with the normalized scope.
    expect(mocks.hydrateRows).toHaveBeenCalledWith({ keyword: '', chips: ['open'] }, expect.any(Array));

    expect(events.at(-1)).toEqual({
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
      '[smart-search:ticket] completed',
      expect.objectContaining({ tenant: 't1', total: 3, scored: 3, inputTokens: 200, queryLength: 7 })
    );
  });

  it('passes the entity prompt to every request', async () => {
    mocks.enumerate.mockResolvedValue(['s1']);
    await collect();
    const request = mocks.systemOne.mock.calls[0][0] as { questions: Record<string, { instructions: { question: string } }> };
    expect(request.questions.c0.instructions.question).toBe('q-c0');
  });

  it('reports a batch that fails after retries and keeps scoring the rest', async () => {
    mocks.enumerate.mockResolvedValue(['s1', 's2', 's3', 's4']);
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
    const scored = events.filter((e): e is Extract<Event, { type: 'scored' }> => e.type === 'scored');
    expect(failed).toHaveLength(1);
    expect((failed[0] as { ids: string[] }).ids).toHaveLength(2);
    expect(scored.flatMap((e) => e.items)).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'done', total: 4, scored: 2, failed: 2, requests: 2 });
    expect(mocks.loggerError).toHaveBeenCalledWith('[smart-search:ticket] batch failed', expect.objectContaining({ error: expect.stringContaining('529') }));
  });

  it('reports rows whose text could not be loaded as unscored', async () => {
    mocks.enumerate.mockResolvedValue(['s1', 'gone']);
    mocks.loadCandidates.mockImplementation(async (_t: unknown, _te: string, _u: unknown, ids: string[]) =>
      candidatesFor(ids.filter((id) => id !== 'gone'))
    );
    const events = await collect();
    const failed = events.find((e) => e.type === 'batch_failed') as { ids: string[]; reason: string };
    expect(failed.ids).toEqual(['gone']);
    expect(failed.reason).toMatch(/could not be loaded/);
    expect(events.at(-1)).toMatchObject({ type: 'done', scored: 1, failed: 1 });
  });

  it('reports rows the hydrator no longer returns as unscored', async () => {
    mocks.enumerate.mockResolvedValue(['s1', 's2']);
    mocks.hydrateRows.mockImplementation(async (_scope: unknown, ids: string[]) => ({
      rows: ids.filter((id) => id !== 's2').map((widget_id) => ({ widget_id, title: widget_id })),
      metadata: { tags: {} },
    }));
    const events = await collect();
    const failed = events.find((e) => e.type === 'batch_failed') as { ids: string[]; reason: string };
    expect(failed.ids).toEqual(['s2']);
    expect(failed.reason).toMatch(/no longer visible/);
  });

  it('never holds more than inflightPerSearch requests open', async () => {
    mocks.enumerate.mockResolvedValue(Array.from({ length: 12 }, (_, i) => `s${i}`)); // 6 batches of 2
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
    mocks.enumerate.mockResolvedValue(Array.from({ length: 12 }, (_, i) => `s${i}`));
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
    mocks.enumerate.mockResolvedValue(Array.from({ length: 12 }, (_, i) => `s${i}`));
    const controller = new AbortController();
    mocks.systemOne.mockImplementation(async (request: never) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return answerFor(request);
    });

    const events: Event[] = [];
    for await (const event of runSmartSearch({ definition, tenant: 't1', user, scope, query: 'q', signal: controller.signal })) {
      events.push(event);
      if (event.type === 'scored') {
        controller.abort();
      }
    }
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(mocks.systemOne.mock.calls.length).toBeLessThan(6);
    expect(mocks.loggerInfo).not.toHaveBeenCalledWith('[smart-search:ticket] completed', expect.anything());
  });
});
