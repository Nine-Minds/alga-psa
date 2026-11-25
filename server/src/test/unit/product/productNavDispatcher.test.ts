import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({ product: 'psa' as string }));
vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: vi.fn(async () => hoisted.product),
}));

import { PRODUCT_NAV_DESTINATIONS, PRODUCT_NAV_TARGETS } from '@alga-psa/types';
import { GET } from '../../../app/msp/go/[target]/route';

const call = (target: string, query = '') =>
  GET(new NextRequest(`https://psa.example.com/msp/go/${target}${query}`), {
    params: Promise.resolve({ target }),
  });

const OUTCOME = '?microsoft_email_setup=error&error_code=X&correlation_id=Y';

describe('/msp/go/[target] dispatcher', () => {
  beforeEach(() => { hoisted.product = 'psa'; });

  it('psa: carries the outcome params onto the integrations destination', async () => {
    const res = await call('providers', OUTCOME);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      '/msp/settings/integrations?category=providers&microsoft_email_setup=error&error_code=X&correlation_id=Y',
    );
  });

  it('co_managed: the same request lands on the co-management providers page with the params', async () => {
    hoisted.product = 'co_managed';
    const res = await call('providers', OUTCOME);
    expect(res.headers.get('location')).toBe(
      '/msp/co-management/providers?microsoft_email_setup=error&error_code=X&correlation_id=Y',
    );
  });

  it('redirects to the bare destination when there is no query', async () => {
    const res = await call('providers');
    expect(res.headers.get('location')).toBe('/msp/settings/integrations?category=providers');
  });

  it('an unknown target is a 404, not a redirect', async () => {
    const res = await call('nope', OUTCOME);
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });

  it("a 'category' param cannot override the destination's own category", async () => {
    const res = await call('providers', '?category=accounting&microsoft_email_setup=ok');
    const url = new URL(res.headers.get('location')!, 'https://psa.example.com');
    expect(url.searchParams.getAll('category')).toEqual(['providers']);
    expect(url.searchParams.get('microsoft_email_setup')).toBe('ok');
  });

  it('the destination is always a relative path, even when a param carries a URL', async () => {
    const res = await call('providers', '?next=https%3A%2F%2Fevil.example%2F');
    const location = res.headers.get('location')!;
    expect(location.startsWith('/msp/')).toBe(true);
    expect(new URL(location, 'https://psa.example.com').origin).toBe('https://psa.example.com');
  });

  it('keeps Cache-Control: no-store', async () => {
    const res = await call('providers');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a request on the internal origin yields a Location with neither the internal nor the public origin', async () => {
    // Behind Istio/CloudFront nextUrl.origin is the upstream address, not the public host.
    const req = new NextRequest('http://localhost:3000/msp/go/mailbox?microsoft_email_setup=ok', {
      headers: { host: 'localhost:3000', 'x-forwarded-host': 'psa.example.com', 'x-forwarded-proto': 'https' },
    });
    const res = await GET(req, { params: Promise.resolve({ target: 'mailbox' }) });
    const location = res.headers.get('location')!;
    expect(location.startsWith('/')).toBe(true);
    expect(location).not.toContain('localhost');
    expect(location).not.toContain('3000');
    expect(location).not.toContain('psa.example.com');
    expect(location).not.toContain('://');
  });

  describe.each(PRODUCT_NAV_TARGETS)('target %s', (target) => {
    it.each(Object.keys(PRODUCT_NAV_DESTINATIONS[target]))('%s: redirects to its per-product destination, relative', async (product) => {
      hoisted.product = product;
      const res = await call(target);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(
        PRODUCT_NAV_DESTINATIONS[target][product as keyof (typeof PRODUCT_NAV_DESTINATIONS)[typeof target]],
      );
    });
  });
});
