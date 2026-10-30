// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

import {
  CippTokenService,
  cippTokenCacheKey,
  classifyCippTokenFailure,
  type CippFetch,
} from '@ee/lib/integrations/entra/providers/cipp/cippTokenService';

const CREDS = {
  clientId: 'client-1',
  clientSecret: 'super-secret-value',
  directoryId: 'dir-1',
};

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function tokenFetch(options: { expiresIn?: number } = {}) {
  let n = 0;
  const fn = vi.fn(async (_url: string, _init: unknown) => {
    n += 1;
    return jsonResponse(200, { access_token: `token-${n}`, expires_in: options.expiresIn ?? 3600 });
  });
  return fn as typeof fn & CippFetch;
}

describe('CippTokenService', () => {
  it('posts a client-credentials grant scoped to api://{clientId}/.default', async () => {
    const fetch = tokenFetch();
    const service = new CippTokenService({ fetch, authorityBaseUrl: 'https://login.example' });

    await service.getToken('t', CREDS);

    const [url, init] = fetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe('https://login.example/dir-1/oauth2/v2.0/token');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(init.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-1',
      client_secret: 'super-secret-value',
      scope: 'api://client-1/.default',
    });
  });

  it('serves a cache hit without minting again', async () => {
    const fetch = tokenFetch();
    const service = new CippTokenService({ fetch, now: () => 0 });

    expect(await service.getToken('t', CREDS)).toBe('token-1');
    expect(await service.getToken('t', CREDS)).toBe('token-1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-mints inside the 60s expiry skew, not before', async () => {
    const fetch = tokenFetch({ expiresIn: 3600 });
    let now = 0;
    const service = new CippTokenService({ fetch, now: () => now });

    expect(await service.getToken('t', CREDS)).toBe('token-1');
    now = 3600_000 - 61_000; // 61s left: still good
    expect(await service.getToken('t', CREDS)).toBe('token-1');
    now = 3600_000 - 59_000; // 59s left: inside the skew
    expect(await service.getToken('t', CREDS)).toBe('token-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keys the cache on a hash, and a rotated secret gets a different key', async () => {
    const a = cippTokenCacheKey('t', CREDS);
    const b = cippTokenCacheKey('t', { ...CREDS, clientSecret: 'rotated-secret' });
    expect(a).not.toBe(b);
    expect(a).not.toContain(CREDS.clientSecret);
    expect(cippTokenCacheKey('t2', CREDS)).not.toBe(a);

    const fetch = tokenFetch();
    const service = new CippTokenService({ fetch, now: () => 0 });
    await service.getToken('t', CREDS);
    await service.getToken('t', { ...CREDS, clientSecret: 'rotated-secret' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('single-flights N concurrent callers into one mint', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async () => {
      await gate;
      return jsonResponse(200, { access_token: 'shared', expires_in: 3600 });
    });
    const service = new CippTokenService({ fetch: fetch as unknown as CippFetch, now: () => 0 });

    const calls = Array.from({ length: 10 }, () => service.getToken('t', CREDS));
    release();
    expect(await Promise.all(calls)).toEqual(Array(10).fill('shared'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed mint, and every waiter rejects', async () => {
    let fail = true;
    const fetch = vi.fn(async () => {
      await Promise.resolve();
      return fail
        ? jsonResponse(401, { error: 'invalid_client', error_description: 'AADSTS7000215: bad', error_codes: [7000215] })
        : jsonResponse(200, { access_token: 'ok', expires_in: 3600 });
    });
    const service = new CippTokenService({ fetch: fetch as unknown as CippFetch, now: () => 0 });

    const waiters = await Promise.allSettled(Array.from({ length: 5 }, () => service.getToken('t', CREDS)));
    expect(waiters.every((w) => w.status === 'rejected')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    fail = false;
    expect(await service.getToken('t', CREDS)).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops the token, but ignores a stale rejection of an older token', async () => {
    const fetch = tokenFetch();
    const service = new CippTokenService({ fetch, now: () => 0 });
    const key = cippTokenCacheKey('t', CREDS);

    const first = await service.getToken('t', CREDS);
    service.invalidate(key, first);
    const second = await service.getToken('t', CREDS);
    expect(second).not.toBe(first);

    service.invalidate(key, first); // late 401 from the old token
    expect(await service.getToken('t', CREDS)).toBe(second);

    service.invalidate(key);
    expect(await service.getToken('t', CREDS)).not.toBe(second);
  });

  it('turns a network failure into a token-mint-failed error without leaking the secret', async () => {
    const fetch = vi.fn(async () => { throw new Error(`socket hang up for ${CREDS.clientSecret}`); });
    const service = new CippTokenService({ fetch: fetch as unknown as CippFetch });
    const error = await service.getToken('t', CREDS).catch((e) => e);
    expect(error.code).toBe('token-mint-failed');
    expect(error.category).toBe('network');
    expect(error.message).not.toContain(CREDS.clientSecret);
  });
});

describe('classifyCippTokenFailure', () => {
  const body = (code: number, oauth = 'invalid_client') => ({
    error: oauth,
    error_description: `AADSTS${code}: details with secret super-secret-value\r\nTrace ID: x`,
    error_codes: [code],
  });

  it.each([
    [7000215, 'token-mint-failed', 'invalid_secret', /secret ID instead of its Value.*expired/s],
    [700016, 'token-mint-failed', 'unknown_client', /Check the Application \(client\) ID and the Tenant \(directory\) ID/],
    [90002, 'token-mint-failed', 'tenant_not_found', /Check the Tenant \(directory\) ID.*15 minutes/s],
    [500011, 'token-scope-rejected', 'scope_rejected', /CIPP > Integrations > CIPP-API, run Repair Identifier URI on this client/],
    [65001, 'token-mint-failed', 'consent_required', /Admin consent is needed/],
  ])('AADSTS%s -> %s / %s', (code, errorCode, category, message) => {
    const error = classifyCippTokenFailure({ httpStatus: 400, body: body(code) });
    expect(error.code).toBe(errorCode);
    expect(error.category).toBe(category);
    expect(error.message).toMatch(message);
    expect(error.aadstsCode).toBe(`AADSTS${code}`);
    // Microsoft's free text is never echoed, so nothing it contains can leak.
    expect(error.message).not.toContain('super-secret-value');
  });

  it('classifies an unrecognised failure generically', () => {
    const error = classifyCippTokenFailure({ httpStatus: 500, body: null });
    expect(error.code).toBe('token-mint-failed');
    expect(error.category).toBe('other');
  });
});
