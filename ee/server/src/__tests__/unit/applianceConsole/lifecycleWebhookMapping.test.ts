import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));

import { StripeService } from '../../../lib/stripe/StripeService';

// Real StripeService boundary + real algaLicenseAdminClient; only fetch and the Stripe client are faked.
const TENANT = '4ead4fab-a3a5-4803-8905-bc5cd15ca6cb';
const sub = {
  object: 'subscription',
  id: 'sub_app',
  status: 'active',
  metadata: { deploymentType: 'appliance', appliance_tenant_id: TENANT },
  cancel_at_period_end: false,
  items: { data: [{ id: 'si_1', quantity: 5, current_period_end: 1_790_000_000, price: { id: 'price_seat', recurring: { interval: 'month' } } }] },
};
const reactivationEvent = {
  id: 'evt_1',
  type: 'customer.subscription.updated',
  created: 1_789_000_000,
  data: { object: sub, previous_attributes: { status: 'unpaid' } },
} as any;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('lifecycle errors → webhook retry mapping (StripeService boundary)', () => {
  const prev = { url: process.env.ALGA_LICENSE_SERVICE_URL, secret: process.env.ALGA_LICENSE_SERVICE_SECRET };
  let service: any;

  beforeEach(() => {
    process.env.ALGA_LICENSE_SERVICE_URL = 'http://alga-license.test';
    process.env.ALGA_LICENSE_SERVICE_SECRET = 's3cret';
    service = Object.create(StripeService.prototype);
    service.stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(sub) } };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of [['ALGA_LICENSE_SERVICE_URL', prev.url], ['ALGA_LICENSE_SERVICE_SECRET', prev.secret]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('route-missing 404 (Fastify default body) becomes a retryable ApplianceLifecycleSyncError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(404, { message: 'Route POST:/reactivate not found', error: 'Not Found', statusCode: 404 }),
    ));
    await expect(service.handleApplianceLifecycleEvent(reactivationEvent)).rejects.toMatchObject({
      name: 'ApplianceLifecycleSyncError',
      retryable: true,
    });
  });

  it('5xx and network failures are retryable too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(503, { error: 'down' })));
    await expect(service.handleApplianceLifecycleEvent(reactivationEvent)).rejects.toMatchObject({ retryable: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(service.handleApplianceLifecycleEvent(reactivationEvent)).rejects.toMatchObject({ retryable: true });
  });

  it('a real not_found 404 on reactivate is tolerated (handled, no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) =>
      url.endsWith('/reactivate') ? json(404, { error: 'no entitlement', code: 'not_found' }) : json(200, { updated: true }),
    ));
    await expect(service.handleApplianceLifecycleEvent(reactivationEvent)).resolves.toBe(true);
  });
});
