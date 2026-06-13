import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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

import { FetchLevelWorkflowClient } from '../levelIoWorkflowRuntimeSupport';

beforeEach(() => {
  secretMocks.getTenantSecret.mockReset();
  secretMocks.getTenantSecret.mockResolvedValue('level-key-1');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FetchLevelWorkflowClient', () => {
  it('authenticates with the raw API key and walks cursor pagination', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'a-1' }], has_more: true }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'a-2' }], has_more: false }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchLevelWorkflowClient('tenant-1', 'https://api.level.io');
    const automations = await client.listAutomations();

    expect(automations.map((a) => a.id)).toEqual(['a-1', 'a-2']);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('level-key-1');
    expect(fetchMock.mock.calls[0][0]).toContain('/v2/automations?');
    expect(fetchMock.mock.calls[1][0]).toContain('starting_after=a-1');
  });

  it('posts the trigger webhook with device_ids and carries the status on failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchLevelWorkflowClient('tenant-1', 'https://api.level.io');
    await client.triggerAutomationWebhook('tok-abc', ['dev-1']);

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.level.io/v2/automations/webhooks/tok-abc');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ device_ids: ['dev-1'] });

    const error = await client.triggerAutomationWebhook('tok-missing').catch((err: unknown) => err);
    expect((error as { status?: number }).status).toBe(404);
  });

  it('retries 429 with backoff before surfacing results', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'run-1', status: 'success' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const client = new FetchLevelWorkflowClient('tenant-1', 'https://api.level.io');
      const promise = client.getAutomationRun('run-1');
      await vi.runAllTimersAsync();
      const run = await promise;

      expect(run.status).toBe('success');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
