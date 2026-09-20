import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import type { SmartSearchEvent } from '@alga-psa/ui/lib/smartSearch/types';

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const evaluateAccessMock = vi.hoisted(() => vi.fn());
const runSmartSearchMock = vi.hoisted(() => vi.fn());
const getSmartSearchEntityMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../services/smartSearch/access', () => ({
  evaluateSmartSearchAccess: evaluateAccessMock,
}));

vi.mock('../../services/smartSearch/runSmartSearch', () => ({
  runSmartSearch: runSmartSearchMock,
}));

vi.mock('../../services/smartSearch/entities', () => ({
  getSmartSearchEntity: getSmartSearchEntityMock,
}));

type Event = SmartSearchEvent<unknown, unknown>;

const definition = {
  entity: 'ticket',
  permissionResource: 'ticket',
  noun: 'tickets',
  scopeSchema: z.object({ boardFilterState: z.string() }),
};

const validBody = {
  scope: { boardFilterState: 'active' },
  query: 'printer offline',
};

const makeRequest = (body: unknown, signal?: AbortSignal) =>
  new NextRequest(
    new Request('http://example.com/api/smart-search/ticket/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  );

const context = (entity = 'ticket') => ({ params: Promise.resolve({ entity }) });

async function* eventsOf(events: Event[]): AsyncGenerator<Event> {
  for (const event of events) {
    yield event;
  }
}

const parseFrames = (raw: string) =>
  raw
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
      const data = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
      return { event, data };
    });

describe('POST /api/smart-search/[entity]/stream (enterprise handler)', () => {
  beforeEach(() => {
    vi.resetModules();
    getCurrentUserMock.mockReset();
    evaluateAccessMock.mockReset();
    runSmartSearchMock.mockReset();
    getSmartSearchEntityMock.mockReset();
    getCurrentUserMock.mockResolvedValue({ tenant: 'tenant-1', user_id: 'user-1' });
    evaluateAccessMock.mockResolvedValue({ allowed: true });
    getSmartSearchEntityMock.mockReturnValue(definition);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const load = async () => (await import('../../app/api/smart-search/[entity]/stream/route')).POST;

  it('answers 404 for an entity that does not offer smart search', async () => {
    const POST = await load();
    const response = await POST(makeRequest(validBody), context('invoice'));
    expect(response.status).toBe(404);
    expect(getSmartSearchEntityMock).not.toHaveBeenCalled();
  });

  it('validates the scope with the entity schema and answers 400 for a blank or over-long query', async () => {
    const POST = await load();
    expect((await POST(makeRequest({ ...validBody, query: '   ' }), context())).status).toBe(400);
    expect((await POST(makeRequest({ ...validBody, query: 'x'.repeat(501) }), context())).status).toBe(400);
    expect((await POST(makeRequest({ scope: { nope: true }, query: 'q' }), context())).status).toBe(400);
    expect(getSmartSearchEntityMock).toHaveBeenCalledWith('ticket');
  });

  it('answers 401 without a session and never evaluates access', async () => {
    const POST = await load();
    getCurrentUserMock.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(validBody), context())).status).toBe(401);
    expect(evaluateAccessMock).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', 403],
    ['FEATURE_FLAG_OFF', 404],
    ['ADD_ON_REQUIRED', 402],
    ['SMART_SEARCH_NOT_CONFIGURED', 503],
  ] as const)('maps the %s denial to %i before spending a token', async (reason, status) => {
    evaluateAccessMock.mockResolvedValue({ allowed: false, reason, message: `denied: ${reason}` });
    const POST = await load();
    const response = await POST(makeRequest(validBody), context());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code: reason, error: `denied: ${reason}` });
    expect(runSmartSearchMock).not.toHaveBeenCalled();
    expect(evaluateAccessMock).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'tenant-1', user_id: 'user-1' }), definition);
  });

  it('turns a runner failure before the first event into a status code, not a stream', async () => {
    runSmartSearchMock.mockImplementation(async function* () {
      const error = new Error('nope');
      (error as { code?: string }).code = 'FORBIDDEN';
      throw error;
      // eslint-disable-next-line no-unreachable
      yield undefined as never;
    });
    const POST = await load();
    const response = await POST(makeRequest(validBody), context());
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('streams named events and ends with [DONE]', async () => {
    const events: Event[] = [
      { type: 'started', searchId: 's', total: 1 },
      {
        type: 'scored',
        scored: 1,
        metadata: { tags: {} },
        items: [{ row: { ticket_id: 't1' }, score: 0.8, bucket: 'strong' }],
      },
      { type: 'done', total: 1, scored: 1, failed: 0, requests: 1, inputTokens: 5, model: 'jev-1.13.0', durationMs: 3 },
    ];
    runSmartSearchMock.mockImplementation(() => eventsOf(events));
    const POST = await load();
    const response = await POST(makeRequest(validBody), context());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(runSmartSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        definition,
        tenant: 'tenant-1',
        scope: { boardFilterState: 'active' },
        query: 'printer offline',
        signal: expect.any(AbortSignal),
      })
    );

    const frames = parseFrames(await response.text());
    expect(frames.map((f) => f.event)).toEqual(['started', 'scored', 'done', undefined]);
    expect(JSON.parse(frames[1].data as string)).toMatchObject({ type: 'scored', items: [{ score: 0.8 }] });
    expect(frames.at(-1)?.data).toBe('[DONE]');
  });

  it('aborts the runner when the request signal aborts', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    runSmartSearchMock.mockImplementation(async function* (input: { signal: AbortSignal }) {
      observedSignal = input.signal;
      yield { type: 'started', searchId: 's', total: 10 } as Event;
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield { type: 'done', total: 10, scored: 0, failed: 0, requests: 0, inputTokens: 0, model: null, durationMs: 1 } as Event;
    });
    const POST = await load();
    const response = await POST(makeRequest(validBody, controller.signal), context());
    expect(response.status).toBe(200);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(observedSignal?.aborted).toBe(true);
  });
});
