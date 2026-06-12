import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories run during module import — hoist the mocks they read.
const { axiosGetMock, axiosCreateMock } = vi.hoisted(() => {
  const axiosGetMock = vi.fn();
  const axiosCreateMock = vi.fn(() => ({ get: axiosGetMock }));
  return { axiosGetMock, axiosCreateMock };
});

vi.mock('axios', () => {
  const isAxiosError = (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError);
  return {
    default: { create: axiosCreateMock, isAxiosError },
    isAxiosError,
  };
});

import { HuntressClient } from '@ee/lib/integrations/huntress/huntressClient';

function axios404() {
  return { isAxiosError: true, response: { status: 404, headers: {} } };
}

function axios429(retryAfter?: string) {
  return {
    isAxiosError: true,
    response: { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} },
  };
}

describe('HuntressClient', () => {
  let sleeps: number[];
  let client: HuntressClient;

  beforeEach(() => {
    vi.clearAllMocks();
    sleeps = [];
    client = new HuntressClient({
      apiKey: 'key',
      apiSecret: 'secret',
      minRequestIntervalMs: 0,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
  });

  it('configures axios with the Basic auth header and default base URL', () => {
    expect(axiosCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.huntress.io',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('key:secret').toString('base64')}`,
        }),
      })
    );
  });

  it('getAccount returns the account payload directly', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: { id: 1, name: 'Acme', subdomain: 'acme' } });
    const account = await client.getAccount();
    expect(account.subdomain).toBe('acme');
    expect(axiosGetMock).toHaveBeenCalledWith('/v1/account', { params: undefined });
  });

  it('listOrganizations follows page tokens and unwraps the organizations key', async () => {
    axiosGetMock
      .mockResolvedValueOnce({
        data: {
          organizations: [{ id: 1, name: 'A' }],
          pagination: { next_page_token: 't2' },
        },
      })
      .mockResolvedValueOnce({
        data: { organizations: [{ id: 2, name: 'B' }], pagination: {} },
      });

    const orgs = await client.listOrganizations();
    expect(orgs.map((o) => o.id)).toEqual([1, 2]);
    expect(axiosGetMock).toHaveBeenCalledTimes(2);
    expect(axiosGetMock.mock.calls[1][1].params).toMatchObject({ page_token: 't2' });
  });

  it('listIncidentReportsPage requests updated_at desc with limit 500', async () => {
    axiosGetMock.mockResolvedValueOnce({
      data: { incident_reports: [], pagination: {} },
    });
    await client.listIncidentReportsPage({ page_token: 'abc' });
    expect(axiosGetMock).toHaveBeenCalledWith('/v1/incident_reports', {
      params: expect.objectContaining({
        limit: 500,
        sort_field: 'updated_at',
        sort_direction: 'desc',
        page_token: 'abc',
      }),
    });
  });

  it('getAgent unwraps the agent key and returns null on 404', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: { agent: { id: 7, hostname: 'SRV01' } } });
    expect((await client.getAgent(7))?.hostname).toBe('SRV01');

    axiosGetMock.mockRejectedValueOnce(axios404());
    expect(await client.getAgent(8)).toBeNull();
  });

  it('getOrganization unwraps the organization key and returns null on 404', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: { organization: { id: 9, name: 'Acme' } } });
    expect((await client.getOrganization(9))?.name).toBe('Acme');

    axiosGetMock.mockRejectedValueOnce(axios404());
    expect(await client.getOrganization(10)).toBeNull();
  });

  it('retries 429 responses using Retry-After, then succeeds', async () => {
    axiosGetMock
      .mockRejectedValueOnce(axios429('3'))
      .mockResolvedValueOnce({ data: { id: 1, name: 'Acme', subdomain: 'acme' } });

    const account = await client.getAccount();
    expect(account.id).toBe(1);
    expect(sleeps).toContain(3000);
  });

  it('gives up after exhausting 429 retries', async () => {
    axiosGetMock
      .mockRejectedValueOnce(axios429())
      .mockRejectedValueOnce(axios429())
      .mockRejectedValueOnce(axios429());

    await expect(client.getAccount()).rejects.toMatchObject({
      response: { status: 429 },
    });
  });

  it('throttles consecutive requests to the configured minimum interval', async () => {
    const throttled = new HuntressClient({
      apiKey: 'key',
      apiSecret: 'secret',
      minRequestIntervalMs: 1000,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    axiosGetMock.mockResolvedValue({ data: { id: 1, name: 'a', subdomain: 's' } });

    await throttled.getAccount();
    await throttled.getAccount();

    // Second call must have waited most of the interval.
    expect(Math.max(0, ...sleeps)).toBeGreaterThan(500);
  });
});
