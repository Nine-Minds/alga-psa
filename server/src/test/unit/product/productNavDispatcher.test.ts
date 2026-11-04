import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({ product: 'psa' as string }));
vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: vi.fn(async () => hoisted.product),
}));

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
      'https://psa.example.com/msp/settings/integrations?category=providers&microsoft_email_setup=error&error_code=X&correlation_id=Y',
    );
  });

  it('co_managed: the same request lands on the co-management providers page with the params', async () => {
    hoisted.product = 'co_managed';
    const res = await call('providers', OUTCOME);
    expect(res.headers.get('location')).toBe(
      'https://psa.example.com/msp/co-management/providers?microsoft_email_setup=error&error_code=X&correlation_id=Y',
    );
  });

  it('redirects to the bare destination when there is no query', async () => {
    const res = await call('providers');
    expect(res.headers.get('location')).toBe('https://psa.example.com/msp/settings/integrations?category=providers');
  });

  it('an unknown target is a 404, not a redirect', async () => {
    const res = await call('nope', OUTCOME);
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });

  it("a 'category' param cannot override the destination's own category", async () => {
    const res = await call('providers', '?category=accounting&microsoft_email_setup=ok');
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.getAll('category')).toEqual(['providers']);
    expect(url.searchParams.get('microsoft_email_setup')).toBe('ok');
  });

  it('the destination is always same-origin', async () => {
    const res = await call('providers', '?next=https%3A%2F%2Fevil.example%2F');
    expect(new URL(res.headers.get('location')!).origin).toBe('https://psa.example.com');
  });
});
