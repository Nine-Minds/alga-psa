import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHostSurfaceCache, getInternalLookupToken, INTERNAL_LOOKUP_HEADER, resolveHostSurface } from 'server/src/lib/portal-domains/hostSurface';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe('resolveHostSurface', () => {
  beforeEach(() => clearHostSurfaceCache());

  it('returns the surface reported for an active custom host and caches it', async () => {
    const fetchImpl = vi.fn(async () => ok({ surface: 'msp' }));
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch, lookupOrigin: 'http://127.0.0.1:3000', now: () => 1000 };

    expect(await resolveHostSurface('Helpdesk.PBNJ.ca', opts)).toBe('msp');
    expect(await resolveHostSurface('helpdesk.pbnj.ca', opts)).toBe('msp');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/api/portal-domain/surface');
    expect(url.searchParams.get('host')).toBe('helpdesk.pbnj.ca');
  });

  it('sends an HMAC-derived lookup token, never the raw auth secret', async () => {
    delete process.env.AUTH_SECRET;
    process.env.NEXTAUTH_SECRET = 'test-secret';
    const fetchImpl = vi.fn(async () => ok({ surface: 'msp' }));
    await resolveHostSurface('helpdesk.pbnj.ca', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const sent = (fetchImpl.mock.calls[0] as any)[1].headers[INTERNAL_LOOKUP_HEADER];
    expect(sent).toBe(await getInternalLookupToken());
    expect(sent).toMatch(/^[0-9a-f]{64}$/);
    expect(sent).not.toBe('test-secret');
    // purpose-bound: HMAC-SHA256('test-secret', 'portal-domain-surface-lookup:v1')
    const { createHmac } = await import('node:crypto');
    expect(sent).toBe(createHmac('sha256', 'test-secret').update('portal-domain-surface-lookup:v1').digest('hex'));
  });

  it('sends no token header when no secret is configured', async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const fetchImpl = vi.fn(async () => ok({ surface: 'msp' }));
    await resolveHostSurface('nosecret.pbnj.ca', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((fetchImpl.mock.calls[0] as any)[1].headers[INTERNAL_LOOKUP_HEADER]).toBeUndefined();
  });

  it('returns null for an unknown host', async () => {
    const fetchImpl = vi.fn(async () => ok({ surface: null }));
    expect(await resolveHostSurface('nope.example.com', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });

  it('fails closed (null) when the lookup throws or answers non-2xx', async () => {
    const throwing = vi.fn(async () => { throw new Error('down'); });
    expect(await resolveHostSurface('a.example.com', { fetchImpl: throwing as unknown as typeof fetch })).toBeNull();
    const bad = vi.fn(async () => ({ ok: false, json: async () => ({ surface: 'msp' }) }) as unknown as Response);
    expect(await resolveHostSurface('b.example.com', { fetchImpl: bad as unknown as typeof fetch })).toBeNull();
  });

  it('re-queries after the TTL expires', async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => ok({ surface: 'both' }));
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now };
    await resolveHostSurface('c.example.com', opts);
    now = 31_000;
    await resolveHostSurface('c.example.com', opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('normalises an unexpected surface value to client_portal', async () => {
    const fetchImpl = vi.fn(async () => ok({ surface: 'weird' }));
    expect(await resolveHostSurface('d.example.com', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe('client_portal');
  });
});
