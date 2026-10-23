import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  http: { request: (args: any) => Promise<any> },
  extra: Record<string, unknown> = {},
  apiKey = 'shared-key'
) {
  return new DattoRmmClient({
    baseUrl: BASE,
    apiKey,
    apiSecret: 's',
    http: http as any,
    sleep: async () => undefined,
    ...extra,
  });
}

const okHttp = (handler: (args: any) => any) => ({
  request: vi.fn(async (args: any) => {
    if (isTokenCall(args)) return { data: { access_token: 'tok', expires_in: 3600 } };
    return handler(args);
  }),
});

describe('DattoRmmClient per-credential limiter', () => {
  beforeEach(() => {
    resetDattoRateLimiters();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps in-flight requests at 6 across client instances that share a credential', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    const http = okHttp(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          releases.push(() => {
            inFlight -= 1;
            resolve({ data: {} });
          });
        })
    );
    const a = makeClient(http);
    const b = makeClient(http);

    const calls = [
      ...Array.from({ length: 5 }, () => a.getAccount()),
      ...Array.from({ length: 5 }, () => b.getAccount()),
    ];

    await vi.waitFor(() => expect(releases.length).toBe(6));
    expect(maxInFlight).toBe(6);

    // Finishing requests hands slots to the queued ones, never above the cap.
    let done = 0;
    while (done < 10) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      releases.shift()!();
      done += 1;
      await Promise.resolve();
    }
    await Promise.all(calls);
    expect(inFlight).toBe(0);
    expect(maxInFlight).toBe(6);
  });

  it('releases the slot when a request fails', async () => {
    const http = okHttp(() => {
      throw axiosError(500);
    });
    const client = makeClient(http);
    for (let i = 0; i < 8; i += 1) {
      await expect(client.getAccount()).rejects.toBeTruthy();
    }
  });

  it('makes other clients for the same credential wait out a 429 window, but not other credentials', async () => {
    const sleepA = vi.fn(async (_ms: number) => undefined);
    const sleepB = vi.fn(async (_ms: number) => undefined);
    const sleepOther = vi.fn(async (_ms: number) => undefined);
    let first = true;
    const httpA = okHttp(() => {
      if (first) {
        first = false;
        throw axiosError(429, { 'retry-after': '5' });
      }
      return { data: {} };
    });
    const httpB = okHttp(() => ({ data: {} }));

    await makeClient(httpA, { sleep: sleepA }).getAccount();
    expect(sleepA).toHaveBeenCalledTimes(1);
    expect(sleepA).toHaveBeenCalledWith(5000);

    // Time has not advanced (fake clock), so the window is still open for B.
    await makeClient(httpB, { sleep: sleepB }).getAccount();
    expect(sleepB).toHaveBeenCalledTimes(1);
    expect(sleepB).toHaveBeenCalledWith(5000);

    await makeClient(httpB, { sleep: sleepOther }, 'another-key').getAccount();
    expect(sleepOther).not.toHaveBeenCalled();

    // Once the window passes nobody waits.
    vi.setSystemTime(new Date('2026-10-19T00:00:06Z'));
    sleepB.mockClear();
    await makeClient(httpB, { sleep: sleepB }).getAccount();
    expect(sleepB).not.toHaveBeenCalled();
  });

  it('waits out a window once per request, not once per retry', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    let n = 0;
    const http = okHttp(() => {
      n += 1;
      if (n <= 2) throw axiosError(429, { 'retry-after': '2' });
      return { data: {} };
    });
    await makeClient(http, { sleep }).getAccount();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 2000]);
  });
});

describe('DattoRmmClient maxRetryAfterMs', () => {
  beforeEach(() => {
    resetDattoRateLimiters();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws DattoRmmRateLimitError instead of sleeping past the budget', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const http = okHttp(() => {
      throw axiosError(429, { 'retry-after': '60' });
    });
    const client = makeClient(http, { sleep, maxRetries: 1, maxRetryAfterMs: 5000 });

    const err = await client.getAccount().catch((e) => e);
    expect(err).toBeInstanceOf(DattoRmmRateLimitError);
    expect(err.retryAfterMs).toBe(60_000);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('still retries once when the wait fits the budget', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    let n = 0;
    const http = okHttp(() => {
      n += 1;
      if (n === 1) throw axiosError(429, { 'retry-after': '3' });
      return { data: { ok: true } };
    });
    const client = makeClient(http, { sleep, maxRetries: 1, maxRetryAfterMs: 5000 });

    await expect(client.getAccount()).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('spends at most the budget in total across waits', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const http = okHttp(() => {
      throw axiosError(429, { 'retry-after': '3' });
    });
    const client = makeClient(http, { sleep, maxRetries: 5, maxRetryAfterMs: 5000 });

    const err = await client.getAccount().catch((e) => e);
    expect(err).toBeInstanceOf(DattoRmmRateLimitError);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0)).toBeLessThanOrEqual(5000);
  });

  it('does not send when a window set by another client exceeds the budget', async () => {
    const blocker = okHttp(() => {
      throw axiosError(429, { 'retry-after': '90' });
    });
    await makeClient(blocker, { maxRetries: 1 }).getAccount().catch(() => undefined);

    const http = okHttp(() => ({ data: {} }));
    const err = await makeClient(http, { maxRetryAfterMs: 5000 }).getAccount().catch((e) => e);
    expect(err).toBeInstanceOf(DattoRmmRateLimitError);
    expect(http.request.mock.calls.filter(([a]) => !isTokenCall(a))).toHaveLength(0);
  });
});

describe('DattoRmmClient transport hardening', () => {
  it('creates its own axios instance with redirects disabled', () => {
    const create = vi.spyOn(axios, 'create');
    new DattoRmmClient({ baseUrl: BASE, apiKey: 'k', apiSecret: 's' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ maxRedirects: 0 }));
    create.mockRestore();
  });

  it('refuses to build for a host that is not a Datto host', () => {
    expect(
      () => new DattoRmmClient({ baseUrl: 'https://attacker.example/api', apiKey: 'k', apiSecret: 's', http: {} as any })
    ).toThrow(/Datto host/);
  });
});
