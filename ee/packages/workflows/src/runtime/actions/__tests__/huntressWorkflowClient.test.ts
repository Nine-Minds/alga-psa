import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const secretMocks = vi.hoisted(() => ({
  getTenantSecret: vi.fn(),
  setTenantSecret: vi.fn()
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: secretMocks.getTenantSecret,
    setTenantSecret: secretMocks.setTenantSecret
  })
}));

import { FetchHuntressWorkflowClient } from '../huntressWorkflowRuntimeSupport';

beforeEach(() => {
  secretMocks.getTenantSecret.mockReset();
  secretMocks.getTenantSecret.mockImplementation(async (_tenant: string, name: string) =>
    name === 'huntress_api_key' ? 'hk' : name === 'huntress_api_secret' ? 'hs' : null
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FetchHuntressWorkflowClient throttle (T010)', () => {
  it('sends Basic auth, spaces consecutive requests, and retries 429 with backoff', async () => {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ account: { id: 1, name: 'MSP' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ agent: { id: 77 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchHuntressWorkflowClient('tenant-1', 'https://api.huntress.io', 1100, sleep);
    await client.getAccount();
    const agent = await client.getAgent(77);

    expect(agent.id).toBe(77);
    const authHeader = fetchMock.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe(`Basic ${Buffer.from('hk:hs').toString('base64')}`);
    // second request waits out the min interval, then backs off 2s for the 429
    expect(sleeps.some((ms) => ms > 0 && ms <= 1100)).toBe(true);
    expect(sleeps).toContain(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('carries the HTTP status on errors and paginates incident reports up to the limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            incident_reports: [{ id: 1 }, { id: 2 }],
            pagination: { next_page_token: 'tok2' }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ incident_reports: [{ id: 3 }], pagination: {} }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchHuntressWorkflowClient('tenant-1', 'https://api.huntress.io', 0);

    const error = await client.resolveIncidentReport(421).catch((err: unknown) => err);
    expect((error as { status?: number }).status).toBe(403);
    expect((error as Error).message).toContain('403');

    const incidents = await client.listIncidentReports({ status: 'sent', limit: 3 });
    expect(incidents.map((incident) => incident.id)).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[1][0]).toContain('status=sent');
    expect(fetchMock.mock.calls[2][0]).toContain('page_token=tok2');
  });
});
