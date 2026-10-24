import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DattoRmmClient, resetDattoRateLimiters } from '@ee/lib/integrations/datto/dattoApiClient';

const BASE = 'https://merlot-api.centrastage.net/api';

function statusError(status: number): any {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.isAxiosError = true;
  err.response = { status, headers: {}, data: {} };
  return err;
}

function networkError(code: string): any {
  const err: any = new Error(code);
  err.isAxiosError = true;
  err.code = code;
  return err;
}

const isTokenCall = (args: any) => String(args.url).endsWith('/auth/oauth/token');

function makeClient(handler: (args: any) => any, extra: Record<string, unknown> = {}) {
  const sleep = vi.fn(async () => undefined);
  const http = {
    request: vi.fn(async (args: any) => {
      if (isTokenCall(args)) return { data: { access_token: 'tok', expires_in: 3600 } };
      return handler(args);
    }),
  };
  const client = new DattoRmmClient({
    baseUrl: BASE,
    apiKey: 'key',
    apiSecret: 's',
    http: http as any,
    sleep,
    ...extra,
  });
  const apiCalls = () => http.request.mock.calls.filter(([a]) => !isTokenCall(a));
  return { client, sleep, apiCalls };
}

describe('DattoRmmClient transient retries', () => {
  beforeEach(() => {
    resetDattoRateLimiters();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([502, 503, 504])('retries a GET that gets a %i and backs off exponentially', async (status) => {
    let n = 0;
    const { client, sleep, apiCalls } = makeClient(() => {
      n += 1;
      if (n <= 2) throw statusError(status);
      return { data: { ok: true } };
    });

    await expect(client.getAccount()).resolves.toEqual({ ok: true });
    expect(apiCalls()).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'])('retries a GET that fails with %s', async (code) => {
    let n = 0;
    const { client, apiCalls } = makeClient(() => {
      n += 1;
      if (n === 1) throw networkError(code);
      return { data: { ok: true } };
    });

    await expect(client.getAccount()).resolves.toEqual({ ok: true });
    expect(apiCalls()).toHaveLength(2);
  });

  it('gives up after two extra attempts', async () => {
    const { client, apiCalls } = makeClient(() => {
      throw statusError(503);
    });

    await expect(client.getAccount()).rejects.toMatchObject({ response: { status: 503 } });
    expect(apiCalls()).toHaveLength(3);
  });

  it('never retries PUT or POST', async () => {
    const { client, apiCalls } = makeClient(() => {
      throw statusError(503);
    });

    await expect(client.createQuickJob('dev', { jobName: 'j', componentUid: 'c' })).rejects.toBeTruthy();
    expect(apiCalls()).toHaveLength(1);

    await expect(client.resolveAlert('a')).rejects.toBeTruthy();
    expect(apiCalls()).toHaveLength(2);

    const reset = makeClient(() => {
      throw networkError('ECONNRESET');
    });
    await expect(reset.client.createQuickJob('dev', { jobName: 'j', componentUid: 'c' })).rejects.toBeTruthy();
    expect(reset.apiCalls()).toHaveLength(1);
  });

  it('does not retry other statuses or unrecognized network errors', async () => {
    const a = makeClient(() => {
      throw statusError(500);
    });
    await expect(a.client.getAccount()).rejects.toBeTruthy();
    expect(a.apiCalls()).toHaveLength(1);

    const b = makeClient(() => {
      throw networkError('ERR_BAD_REQUEST');
    });
    await expect(b.client.getAccount()).rejects.toBeTruthy();
    expect(b.apiCalls()).toHaveLength(1);
  });

  it('does not sleep past a small maxRetryAfterMs budget', async () => {
    const { client, sleep, apiCalls } = makeClient(
      () => {
        throw statusError(503);
      },
      { maxRetryAfterMs: 1500 }
    );

    await expect(client.getAccount()).rejects.toMatchObject({ response: { status: 503 } });
    // The 1s backoff fits; the following 2s does not.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000]);
    expect(apiCalls()).toHaveLength(2);
  });

  it('honors maxRetries: 0 as no retries', async () => {
    const { client, apiCalls } = makeClient(
      () => {
        throw statusError(503);
      },
      { maxRetries: 0 }
    );
    await expect(client.getAccount()).rejects.toBeTruthy();
    expect(apiCalls()).toHaveLength(1);
  });

  it('retries paginated follow-up pages', async () => {
    let followUps = 0;
    const { client } = makeClient((args) => {
      if (String(args.url).includes('page=2')) {
        followUps += 1;
        if (followUps === 1) throw statusError(502);
        return { data: { sites: [{ uid: 'b' }] } };
      }
      return {
        data: { sites: [{ uid: 'a' }], pageDetails: { nextPageUrl: `${BASE}/v2/account/sites?page=2` } },
      };
    });

    const sites = await client.listSites();
    expect(sites.map((s) => s.uid)).toEqual(['a', 'b']);
    expect(followUps).toBe(2);
  });
});
