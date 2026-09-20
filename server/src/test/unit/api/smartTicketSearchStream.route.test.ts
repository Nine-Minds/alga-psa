import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SmartSearchEvent } from '@alga-psa/tickets/lib/smartTicketSearch/types';

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const isConfiguredMock = vi.hoisted(() => vi.fn());
const runSmartTicketSearchMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@ee/services/smartTicketSearch/typesafeClient', () => ({
  isSmartTicketSearchConfigured: isConfiguredMock,
}));

vi.mock('@ee/services/smartTicketSearch/runSmartTicketSearch', () => ({
  runSmartTicketSearch: runSmartTicketSearchMock,
}));

const validBody = {
  filters: { boardFilterState: 'active' },
  query: 'printer offline',
};

const makeRequest = (body: unknown, signal?: AbortSignal) =>
  new NextRequest(
    new Request('http://example.com/api/tickets/smart-search/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  );

async function* eventsOf(events: SmartSearchEvent[]): AsyncGenerator<SmartSearchEvent> {
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

describe('POST /api/tickets/smart-search/stream', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    getCurrentUserMock.mockReset();
    hasPermissionMock.mockReset();
    isConfiguredMock.mockReset();
    runSmartTicketSearchMock.mockReset();
    getCurrentUserMock.mockResolvedValue({ tenant: 'tenant-1', user_id: 'user-1' });
    hasPermissionMock.mockResolvedValue(true);
    isConfiguredMock.mockResolvedValue(true);
    process.env.EDITION = 'ee';
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    if (originalEdition === undefined) delete process.env.EDITION;
    else process.env.EDITION = originalEdition;
    if (originalPublicEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
  });

  const load = async () => (await import('@/app/api/tickets/smart-search/stream/route')).POST;

  it('answers 404 in community edition before touching auth', async () => {
    process.env.EDITION = 'ce';
    const POST = await load();
    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'ENTERPRISE_EDITION_REQUIRED' });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a blank or over-long query', async () => {
    const POST = await load();
    expect((await POST(makeRequest({ ...validBody, query: '   ' }))).status).toBe(400);
    expect((await POST(makeRequest({ ...validBody, query: 'x'.repeat(501) }))).status).toBe(400);
  });

  it('answers 401 without a session and 403 without ticket read', async () => {
    const POST = await load();
    getCurrentUserMock.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(validBody))).status).toBe(401);
    hasPermissionMock.mockResolvedValueOnce(false);
    const forbidden = await POST(makeRequest(validBody));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers 503 when no TypeSafe key is configured', async () => {
    isConfiguredMock.mockResolvedValue(false);
    const POST = await load();
    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'SMART_SEARCH_NOT_CONFIGURED' });
    expect(runSmartTicketSearchMock).not.toHaveBeenCalled();
  });

  it('turns a runner failure before the first event into a status code, not a stream', async () => {
    runSmartTicketSearchMock.mockImplementation(async function* () {
      const error = new Error('nope');
      (error as { code?: string }).code = 'FORBIDDEN';
      throw error;
      // eslint-disable-next-line no-unreachable
      yield undefined as never;
    });
    const POST = await load();
    const response = await POST(makeRequest(validBody));
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('streams named events and ends with [DONE]', async () => {
    const events: SmartSearchEvent[] = [
      { type: 'started', searchId: 's', total: 1 },
      {
        type: 'scored',
        scored: 1,
        metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} },
        items: [{ ticket: { ticket_id: 't1' } as never, score: 0.8, bucket: 'strong' }],
      },
      { type: 'done', total: 1, scored: 1, failed: 0, requests: 1, inputTokens: 5, model: 'jev-1.13.0', durationMs: 3 },
    ];
    runSmartTicketSearchMock.mockImplementation(() => eventsOf(events));
    const POST = await load();
    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(runSmartTicketSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'tenant-1', query: 'printer offline', signal: expect.any(AbortSignal) })
    );

    const frames = parseFrames(await response.text());
    expect(frames.map((f) => f.event)).toEqual(['started', 'scored', 'done', undefined]);
    expect(JSON.parse(frames[1].data as string)).toMatchObject({ type: 'scored', items: [{ score: 0.8 }] });
    expect(frames.at(-1)?.data).toBe('[DONE]');
  });

  it('aborts the runner when the request signal aborts', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    runSmartTicketSearchMock.mockImplementation(async function* (input: { signal: AbortSignal }) {
      observedSignal = input.signal;
      yield { type: 'started', searchId: 's', total: 10 } as SmartSearchEvent;
      await new Promise((resolve) => setTimeout(resolve, 20));
      yield { type: 'done', total: 10, scored: 0, failed: 0, requests: 0, inputTokens: 0, model: null, durationMs: 1 } as SmartSearchEvent;
    });
    const POST = await load();
    const response = await POST(makeRequest(validBody, controller.signal));
    expect(response.status).toBe(200);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(observedSignal?.aborted).toBe(true);
  });
});
