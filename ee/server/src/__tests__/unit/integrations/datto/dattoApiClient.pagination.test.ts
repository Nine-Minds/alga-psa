import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DattoRmmClient,
  DattoRmmRateLimitError,
  resetDattoRateLimiters,
} from '@ee/lib/integrations/datto/dattoApiClient';

const BASE = 'https://merlot-api.centrastage.net/api';

function axiosError(status: number, headers: Record<string, string> = {}): any {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.isAxiosError = true;
  err.response = { status, headers, data: {} };
  return err;
}

const isTokenCall = (args: any) => String(args.url).endsWith('/auth/oauth/token');

function makeClient(
  handler: (args: any) => any,
  extra: { sleep?: (ms: number) => Promise<void>; maxRetries?: number } = {}
) {
  const http = {
    request: vi.fn(async (args: any) => {
      if (isTokenCall(args)) return { data: { access_token: 'tok', expires_in: 3600 } };
      return handler(args);
    }),
  };
  const client = new DattoRmmClient({
    baseUrl: BASE,
    apiKey: 'k',
    apiSecret: 's',
    http: http as any,
    sleep: async () => undefined,
    ...extra,
  });
  return { client, http };
}

const apiCalls = (http: { request: { mock: { calls: any[][] } } }) =>
  http.request.mock.calls.map(([a]) => a).filter((a) => !isTokenCall(a));

beforeEach(() => {
  resetDattoRateLimiters();
});

describe('DattoRmmClient pagination', () => {
  it('walks pageDetails.nextPageUrl until it is null and requests max=250', async () => {
    const { client, http } = makeClient((args) => {
      if (args.url === `${BASE}/v2/account/sites`) {
        return {
          data: {
            pageDetails: { count: 2, totalCount: 3, nextPageUrl: `${BASE}/v2/account/sites?page=1&max=250` },
            sites: [{ uid: 'a' }, { uid: 'b' }],
          },
        };
      }
      if (args.url === `${BASE}/v2/account/sites?page=1&max=250`) {
        return { data: { pageDetails: { count: 1, totalCount: 3, nextPageUrl: null }, sites: [{ uid: 'c' }] } };
      }
      throw new Error(`Unexpected url ${args.url}`);
    });

    const sites = await client.listSites();

    expect(sites.map((s) => s.uid)).toEqual(['a', 'b', 'c']);
    const calls = apiCalls(http);
    expect(calls).toHaveLength(2);
    expect(calls[0].params).toEqual({ max: 250 });
    // The absolute nextPageUrl is requested as-is, with the bearer token.
    expect(calls[1].url).toBe(`${BASE}/v2/account/sites?page=1&max=250`);
    expect(calls[1].headers.Authorization).toBe('Bearer tok');
  });

  it('yields one array per page from the generator', async () => {
    const { client } = makeClient((args) => {
      if (String(args.url).includes('page=1')) {
        return { data: { pageDetails: { nextPageUrl: null }, devices: [{ uid: 'd3' }] } };
      }
      return {
        data: {
          pageDetails: { nextPageUrl: `${BASE}/v2/site/s1/devices?page=1&max=250` },
          devices: [{ uid: 'd1' }, { uid: 'd2' }],
        },
      };
    });

    const pages: string[][] = [];
    for await (const devices of client.pageSiteDevices('s1')) pages.push(devices.map((d) => d.uid));
    expect(pages).toEqual([['d1', 'd2'], ['d3']]);
  });

  it('stops when the items key or pageDetails is missing', async () => {
    const { client } = makeClient(() => ({ data: {} }));
    await expect(client.listOpenAlerts()).resolves.toEqual([]);
  });

  it('refuses to follow a nextPageUrl on a different origin', async () => {
    const { client, http } = makeClient(() => ({
      data: { pageDetails: { nextPageUrl: 'https://evil.example/api/v2/account/sites?page=1' }, sites: [{ uid: 'a' }] },
    }));

    await expect(client.listSites()).rejects.toThrow(/different host/);
    expect(apiCalls(http)).toHaveLength(1);
  });

  it('throws on a repeating nextPageUrl so a truncated list never looks complete', async () => {
    const { client, http } = makeClient(() => ({
      data: { pageDetails: { nextPageUrl: `${BASE}/v2/account/sites?page=1` }, sites: [{ uid: 'a' }] },
    }));

    await expect(client.listSites()).rejects.toThrow(/repeated a page URL/);
    expect(apiCalls(http)).toHaveLength(2);
  });

  it('throws instead of returning a partial list when the page cap is hit', async () => {
    let n = 0;
    const { client } = makeClient(() => {
      n += 1;
      return { data: { pageDetails: { nextPageUrl: `${BASE}/v2/account/alerts/open?page=${n}` }, alerts: [] } };
    });

    await expect(client.listOpenAlerts()).rejects.toThrow(/exceeded 10000 pages/);
  });
});

describe('DattoRmmClient rate limiting', () => {
  it('honors Retry-After seconds on 429 using the injected sleep', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    let n = 0;
    const { client } = makeClient(
      () => {
        n += 1;
        if (n === 1) throw axiosError(429, { 'retry-after': '7' });
        return { data: { name: 'Acme' } };
      },
      { sleep }
    );

    await expect(client.getAccount()).resolves.toEqual({ name: 'Acme' });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('backs off exponentially when Retry-After is absent', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    let n = 0;
    const { client } = makeClient(
      () => {
        n += 1;
        if (n <= 3) throw axiosError(429);
        return { data: {} };
      },
      { sleep }
    );

    await client.getAccount();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it('gives up after maxRetries and surfaces the 429', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const { client, http } = makeClient(() => {
      throw axiosError(429, { 'retry-after': '1' });
    }, { sleep, maxRetries: 2 });

    const err = await client.getAccount().catch((e) => e);
    expect(err.response.status).toBe(429);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(apiCalls(http)).toHaveLength(3);
  });

  it('counts every HTTP request including retries and the token fetch', async () => {
    let n = 0;
    const { client } = makeClient(() => {
      n += 1;
      if (n === 1) throw axiosError(429, { 'retry-after': '0' });
      return { data: {} };
    });

    await client.getAccount();
    expect(client.requestCount).toBe(3);
  });
});
