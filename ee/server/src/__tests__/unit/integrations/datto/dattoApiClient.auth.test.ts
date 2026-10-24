import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DattoRmmAuthError,
  DattoRmmClient,
  DattoRmmPermissionError,
  resetDattoRateLimiters,
  type DattoTokenStore,
} from '@ee/lib/integrations/datto/dattoApiClient';

const BASE = 'https://merlot-api.centrastage.net/api';

function axiosError(status: number, headers: Record<string, string> = {}): any {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.isAxiosError = true;
  err.response = { status, headers, data: {} };
  return err;
}

type Handler = (args: any) => Promise<{ data: any }> | { data: any };

function makeClient(handler: Handler, extra: Record<string, unknown> = {}) {
  const http = { request: vi.fn(async (args: any) => handler(args)) };
  const client = new DattoRmmClient({
    baseUrl: BASE,
    apiKey: 'key-123',
    apiSecret: 'secret-456',
    http: http as any,
    sleep: async () => undefined,
    ...extra,
  });
  return { client, http };
}

const isTokenCall = (args: any) => String(args.url).endsWith('/auth/oauth/token');

describe('DattoRmmClient auth', () => {
  beforeEach(() => {
    resetDattoRateLimiters();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches a token with basic public-client auth and a password-grant form body', async () => {
    const { client, http } = makeClient((args) => {
      if (isTokenCall(args)) return { data: { access_token: 'tok_1', expires_in: 3600 } };
      return { data: { name: 'Acme MSP' } };
    });

    await expect(client.getAccount()).resolves.toEqual({ name: 'Acme MSP' });

    const tokenCall = http.request.mock.calls[0][0];
    expect(tokenCall.method).toBe('POST');
    // Token endpoint is at the host root, not under /api (Datto returns 403 there).
    expect(tokenCall.url).toBe(`${BASE.replace(/\/api$/, '')}/auth/oauth/token`);
    expect(tokenCall.url).not.toContain('/api/auth/');
    expect(tokenCall.headers.Authorization).toBe(`Basic ${Buffer.from('public-client:public').toString('base64')}`);
    expect(tokenCall.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(tokenCall.data));
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('username')).toBe('key-123');
    expect(body.get('password')).toBe('secret-456');

    const apiCall = http.request.mock.calls[1][0];
    expect(apiCall.url).toBe(`${BASE}/v2/account`);
    expect(apiCall.headers.Authorization).toBe('Bearer tok_1');
    expect(client.requestCount).toBe(2);
  });

  it('reuses the cached token until it is within five minutes of expiry', async () => {
    const { client, http } = makeClient((args) => {
      if (isTokenCall(args)) return { data: { access_token: 'tok_1', expires_in: 3600 } };
      return { data: {} };
    });

    await client.getAccount();
    await client.getAccount();
    expect(http.request.mock.calls.filter(([a]) => isTokenCall(a))).toHaveLength(1);

    // 56 minutes later the token has under five minutes left.
    vi.setSystemTime(new Date('2026-10-19T00:56:00Z'));
    await client.getAccount();
    expect(http.request.mock.calls.filter(([a]) => isTokenCall(a))).toHaveLength(2);
  });

  it('defaults the token lifetime to 100 hours when expires_in is absent', async () => {
    const set = vi.fn(async () => undefined);
    const store: DattoTokenStore = { get: async () => null, set };
    const { client } = makeClient(
      (args) => (isTokenCall(args) ? { data: { access_token: 'tok_1' } } : { data: {} }),
      { tokenStore: store }
    );

    await client.getAccount();
    expect(set).toHaveBeenCalledWith('tok_1', Date.now() + 100 * 60 * 60 * 1000);
  });

  it('uses a stored token without calling the token endpoint', async () => {
    const store: DattoTokenStore = {
      get: async () => ({ token: 'stored', expiresAt: Date.now() + 60 * 60 * 1000 }),
      set: vi.fn(async () => undefined),
    };
    const { client, http } = makeClient(() => ({ data: {} }), { tokenStore: store });

    await client.getAccount();
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(http.request.mock.calls[0][0].headers.Authorization).toBe('Bearer stored');
  });

  it('re-authenticates once on 401 and retries the request', async () => {
    let tokenN = 0;
    let apiN = 0;
    const clear = vi.fn(async () => undefined);
    const store: DattoTokenStore = { get: async () => null, set: async () => undefined, clear };
    const { client, http } = makeClient(
      (args) => {
        if (isTokenCall(args)) {
          tokenN += 1;
          return { data: { access_token: `tok_${tokenN}`, expires_in: 3600 } };
        }
        apiN += 1;
        if (apiN === 1) throw axiosError(401);
        return { data: { ok: true } };
      },
      { tokenStore: store }
    );

    await expect(client.getAccount()).resolves.toEqual({ ok: true });
    expect(tokenN).toBe(2);
    expect(clear).toHaveBeenCalledTimes(1);
    const apiCalls = http.request.mock.calls.filter(([a]) => !isTokenCall(a));
    expect(apiCalls.map(([a]) => a.headers.Authorization)).toEqual(['Bearer tok_1', 'Bearer tok_2']);
  });

  it('throws DattoRmmAuthError on a second 401 without flagging the credentials as dead', async () => {
    const onAuthFailure = vi.fn();
    const { client, http } = makeClient(
      (args) => {
        if (isTokenCall(args)) return { data: { access_token: 'tok', expires_in: 3600 } };
        throw axiosError(401);
      },
      { onAuthFailure }
    );

    const err = await client.getAccount().catch((e) => e);
    expect(err).toBeInstanceOf(DattoRmmAuthError);
    expect(err.status).toBe(401);
    expect(err.path).toBe('/v2/account');
    // The token endpoint accepted the credentials, so a resource 401 must not
    // mark the integration reconnect-required.
    expect(onAuthFailure).not.toHaveBeenCalled();
    // token, call, token, call: one re-auth, one retry, no loop.
    expect(http.request).toHaveBeenCalledTimes(4);
  });

  it('maps a rejected token request to DattoRmmAuthError without echoing credentials', async () => {
    const onAuthFailure = vi.fn();
    const { client } = makeClient(
      (args) => {
        if (isTokenCall(args)) throw axiosError(401);
        return { data: {} };
      },
      { onAuthFailure }
    );

    const err = await client.getAccount().catch((e) => e);
    expect(err).toBeInstanceOf(DattoRmmAuthError);
    expect(err.message).not.toContain('secret-456');
    expect(err.message).not.toContain('key-123');
    // This is the one place the credentials are known to be rejected.
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('retries with a different, unexpired token another process stored before re-authenticating', async () => {
    let stored: { token: string; expiresAt: number } | null = { token: 'tok_old', expiresAt: Date.now() + 3600_000 };
    const clear = vi.fn(async () => undefined);
    const store: DattoTokenStore = { get: async () => stored, set: async () => undefined, clear };
    const { client, http } = makeClient(
      (args) => {
        if (isTokenCall(args)) return { data: { access_token: 'tok_mine', expires_in: 3600 } };
        if (args.headers.Authorization === 'Bearer tok_old') {
          // Another worker rotated the shared token while ours was in flight.
          stored = { token: 'tok_rotated', expiresAt: Date.now() + 3600_000 };
          throw axiosError(401);
        }
        return { data: { ok: true } };
      },
      { tokenStore: store }
    );

    await expect(client.getAccount()).resolves.toEqual({ ok: true });
    const apiAuth = http.request.mock.calls.filter(([a]) => !isTokenCall(a)).map(([a]) => a.headers.Authorization);
    expect(apiAuth).toEqual(['Bearer tok_old', 'Bearer tok_rotated']);
    // No token fetch and no store wipe: the rotated token worked.
    expect(http.request.mock.calls.filter(([a]) => isTokenCall(a))).toHaveLength(0);
    expect(clear).not.toHaveBeenCalled();
  });

  it('ignores a stored token that is the same as, or expired compared with, the failed one', async () => {
    const store: DattoTokenStore = {
      get: async () => ({ token: 'tok_old', expiresAt: Date.now() + 3600_000 }),
      set: async () => undefined,
      clear: vi.fn(async () => undefined),
    };
    let apiN = 0;
    const { client, http } = makeClient(
      (args) => {
        if (isTokenCall(args)) return { data: { access_token: 'tok_new', expires_in: 3600 } };
        apiN += 1;
        if (apiN === 1) throw axiosError(401);
        return { data: {} };
      },
      { tokenStore: store }
    );

    await client.getAccount();
    expect(http.request.mock.calls.filter(([a]) => isTokenCall(a))).toHaveLength(1);
    expect(store.clear).toHaveBeenCalledTimes(1);
  });

  it('does not flag the credentials when the rotated token also fails and a fresh one then gets a 401', async () => {
    let stored: { token: string; expiresAt: number } | null = { token: 'tok_old', expiresAt: Date.now() + 3600_000 };
    const store: DattoTokenStore = { get: async () => stored, set: async () => undefined, clear: async () => undefined };
    const onAuthFailure = vi.fn();
    const { client } = makeClient(
      (args) => {
        if (isTokenCall(args)) return { data: { access_token: 'tok_mine', expires_in: 3600 } };
        if (args.headers.Authorization === 'Bearer tok_old') stored = { token: 'tok_rotated', expiresAt: Date.now() + 3600_000 };
        throw axiosError(401);
      },
      { tokenStore: store, onAuthFailure }
    );

    await expect(client.getAccount()).rejects.toBeInstanceOf(DattoRmmAuthError);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('throws DattoRmmPermissionError on 403 naming the forbidden path', async () => {
    const { client, http } = makeClient((args) => {
      if (isTokenCall(args)) return { data: { access_token: 'tok', expires_in: 3600 } };
      throw axiosError(403);
    });

    const err = await client.listSites().catch((e) => e);
    expect(err).toBeInstanceOf(DattoRmmPermissionError);
    expect(err.status).toBe(403);
    expect(err.path).toBe('/v2/account/sites');
    expect(err.message).toContain('/v2/account/sites');
    expect(err.message).toContain('security level');
    // 403 is not retried.
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('strips credentials from rethrown axios errors', async () => {
    const { client } = makeClient((args) => {
      if (isTokenCall(args)) return { data: { access_token: 'tok_secret', expires_in: 3600 } };
      const err = axiosError(500);
      err.config = { url: args.url, method: 'get', headers: { Authorization: 'Bearer tok_secret' } };
      throw err;
    });

    const err = await client.getAccount().catch((e) => e);
    expect(JSON.stringify(err.config)).not.toContain('tok_secret');
    expect(err.response.status).toBe(500);
  });

  it('keeps a fresh token another request already fetched when a stale 401 lands late', async () => {
    let stored: { token: string; expiresAt: number } | null = { token: 'tok_old', expiresAt: Date.now() + 3600_000 };
    const clear = vi.fn(async () => {
      stored = null;
    });
    const store: DattoTokenStore = { get: async () => stored, set: async () => undefined, clear };
    const { client, http } = makeClient(
      (args) => {
        if (isTokenCall(args)) return { data: { access_token: 'tok_unexpected', expires_in: 3600 } };
        if (args.headers.Authorization === 'Bearer tok_old') {
          // A concurrent request re-authenticated and stored a new token meanwhile.
          stored = { token: 'tok_fresh', expiresAt: Date.now() + 3600_000 };
          throw axiosError(401);
        }
        return { data: { ok: true } };
      },
      { tokenStore: store }
    );

    await expect(client.getAccount()).resolves.toEqual({ ok: true });
    expect(clear).not.toHaveBeenCalled();
    expect(stored).toMatchObject({ token: 'tok_fresh' });
  });

  it('does not null a newer in-memory token when invalidating the one that failed', async () => {
    let tokenN = 0;
    const clear = vi.fn(async () => undefined);
    // No stored copy: the in-memory token is the only place a newer one can live.
    const store: DattoTokenStore = { get: async () => null, set: async () => undefined, clear };
    const { client, http } = makeClient(
      (args) => {
        if (isTokenCall(args)) {
          tokenN += 1;
          return { data: { access_token: `tok_${tokenN}`, expires_in: 3600 } };
        }
        return { data: { ok: true } };
      },
      { tokenStore: store }
    );
    await client.getAccount(); // tok_1 cached

    // Simulate a stale failure for a token that is no longer current.
    (client as any).token = { token: 'tok_newer', expiresAt: Date.now() + 3600_000 };
    await (client as any).invalidateToken('tok_1');

    expect((client as any).token?.token).toBe('tok_newer');
    expect(http.request.mock.calls.filter(([a]) => isTokenCall(a))).toHaveLength(1);
  });
});
