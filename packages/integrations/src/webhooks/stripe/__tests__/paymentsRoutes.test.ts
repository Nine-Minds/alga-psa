import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Stripe from 'stripe';

const A = '0ad8e710-13bc-4e01-a6ca-3f8992978ae8';
const B = '5b3f0f5e-7a7e-4c3e-9d0b-1f0a1c2d3e4f';
const SECRETS: Record<string, string> = { [A]: 'whsec_a', [B]: 'whsec_b' };
const PLATFORM = 'whsec_platform';

const enabled = new Set<string>([A, B]);
const processWebhookEvent = vi.fn(async () => ({ success: true, paymentRecorded: false }));
const createdFor: string[] = [];
const migrate = vi.fn(async (_t: string) => {});

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async (n: string) => (n === 'stripe_webhook_secret' ? PLATFORM : undefined),
    getTenantSecret: async (t: string) => SECRETS[t],
  })),
}));
vi.mock('../paymentsTenants', () => ({
  listEnabledStripeTenants: async () => [...enabled],
  isStripeTenantEnabled: async (t: string) => enabled.has(t),
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@enterprise/lib/payments', () => ({
  PaymentService: { create: async (t: string) => { createdFor.push(t); return { processWebhookEvent }; } },
  migrateStripeWebhookEndpointOnDemand: (t: string) => migrate(t),
  createStripePaymentProvider: () => ({ parseWebhookEvent: (p: string) => JSON.parse(p) }),
}));

import { POST as legacyPOST } from '../payments';
import { POST as tenantPOST } from '../paymentsTenantRoute';

function body(metadata: Record<string, string> = {}, type = 'payment_intent.succeeded') {
  return JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object: { id: 'pi_1', metadata } } });
}
function req(raw: string, secret: string | null, header?: string): any {
  const sig = header ?? (secret ? Stripe.webhooks.generateTestHeaderString({ payload: raw, secret }) : null);
  return { text: async () => raw, headers: { get: (n: string) => (n.toLowerCase() === 'stripe-signature' ? sig : null) } };
}
const tenantCtx = (t: string) => ({ params: Promise.resolve({ tenantId: t }) });

describe('Stripe payments webhook routes', () => {
  const prev = process.env.NEXT_PUBLIC_EDITION;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    processWebhookEvent.mockClear();
    migrate.mockReset(); migrate.mockImplementation(async () => {});
    createdFor.length = 0;
    enabled.clear(); enabled.add(A); enabled.add(B);
  });
  afterEach(() => { if (prev === undefined) delete process.env.NEXT_PUBLIC_EDITION; else process.env.NEXT_PUBLIC_EDITION = prev; });

  it('untagged event signed by A is dispatched to A on the tenant route', async () => {
    const raw = body();
    const res = await tenantPOST(req(raw, SECRETS[A]), tenantCtx(A));
    expect(res.status).toBe(200);
    expect(createdFor).toEqual([A]);
  });

  it('untagged event signed by A is dispatched to A on the legacy route', async () => {
    const res = await legacyPOST(req(body(), SECRETS[A]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: true });
    expect(createdFor).toEqual([A]);
  });

  it('payload tagged B signed with A secret: 200 ignored, nothing dispatched (both routes)', async () => {
    const raw = body({ tenant_id: B });
    for (const res of [await legacyPOST(req(raw, SECRETS[A])), await tenantPOST(req(raw, SECRETS[A]), tenantCtx(A))]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ignored', processed: false });
    }
    expect(createdFor).toEqual([]);
  });

  it('tampered signature: 401 with no candidate details', async () => {
    const res = await legacyPOST(req(body(), null, 't=1,v1=deadbeef'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid signature' });
    const res2 = await tenantPOST(req(body(), null, 't=1,v1=deadbeef'), tenantCtx(A));
    expect(res2.status).toBe(401);
    expect(await res2.json()).toEqual({ error: 'Invalid signature' });
  });

  it('tenant route does not accept another tenant\'s or the platform secret', async () => {
    expect((await tenantPOST(req(body(), SECRETS[B]), tenantCtx(A))).status).toBe(401);
    expect((await tenantPOST(req(body(), PLATFORM), tenantCtx(A))).status).toBe(401);
  });

  it('tenant route: unknown or disabled tenant is 404', async () => {
    expect((await tenantPOST(req(body(), SECRETS[A]), tenantCtx('not-a-tenant'))).status).toBe(404);
    enabled.delete(A);
    expect((await tenantPOST(req(body(), SECRETS[A]), tenantCtx(A))).status).toBe(404);
  });

  it('legacy route: platform-signed untagged non-license event is acked and ignored', async () => {
    const res = await legacyPOST(req(body(), PLATFORM));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ignored' });
    expect(createdFor).toEqual([]);
  });

  it('legacy route: platform-signed tenant-tagged event is dispatched to the tagged tenant', async () => {
    const res = await legacyPOST(req(body({ tenant_id: B }), PLATFORM));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: true });
    expect(createdFor).toEqual([B]);
  });

  it('legacy route: platform-signed license order is still routed to the license handler', async () => {
    const raw = JSON.stringify({
      id: 'evt_lic', object: 'event', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', metadata: { is_license_order: 'true' } } },
    });
    const res = await legacyPOST(req(raw, PLATFORM));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ purpose: 'license_order' });
    expect(createdFor).toEqual([]);
  });

  it('verified but malformed event is 400', async () => {
    const raw = JSON.stringify({ id: 'evt_x', object: 'event' });
    expect((await legacyPOST(req(raw, SECRETS[A]))).status).toBe(400);
  });

  describe('on-demand endpoint migration trigger', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('legacy delivery verified by a tenant secret triggers exactly once with unchanged response', async () => {
      const res = await legacyPOST(req(body(), SECRETS[A]));
      await flush();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ received: true, processed: true });
      expect(migrate).toHaveBeenCalledTimes(1);
      expect(migrate).toHaveBeenCalledWith(A);
    });

    it('tenant-mismatch (ignored) and malformed-but-verified legacy deliveries also trigger', async () => {
      await legacyPOST(req(body({ tenant_id: B }), SECRETS[A]));
      await legacyPOST(req(JSON.stringify({ id: 'evt_x', object: 'event' }), SECRETS[A]));
      await flush();
      expect(migrate).toHaveBeenCalledTimes(2);
      expect(migrate).toHaveBeenNthCalledWith(1, A);
      expect(migrate).toHaveBeenNthCalledWith(2, A);
    });

    it('platform-verified legacy deliveries (license order, untagged, tagged) trigger nothing', async () => {
      const lic = JSON.stringify({
        id: 'evt_lic', object: 'event', type: 'checkout.session.completed',
        data: { object: { id: 'cs_1', metadata: { is_license_order: 'true' } } },
      });
      await legacyPOST(req(lic, PLATFORM));
      await legacyPOST(req(body(), PLATFORM));
      await legacyPOST(req(body({ tenant_id: B }), PLATFORM));
      await flush();
      expect(migrate).not.toHaveBeenCalled();
    });

    it('per-tenant route delivery triggers nothing', async () => {
      expect((await tenantPOST(req(body(), SECRETS[A]), tenantCtx(A))).status).toBe(200);
      await flush();
      expect(migrate).not.toHaveBeenCalled();
    });

    it('invalid signature and missing header trigger nothing', async () => {
      expect((await legacyPOST(req(body(), null, 't=1,v1=deadbeef'))).status).toBe(401);
      expect((await legacyPOST(req(body(), null))).status).toBe(400);
      await flush();
      expect(migrate).not.toHaveBeenCalled();
    });

    it('a trigger that throws or rejects does not change status or body', async () => {
      const baseline = await (await legacyPOST(req(body(), SECRETS[A]))).json();
      migrate.mockImplementationOnce(() => { throw new Error('boom'); });
      const r1 = await legacyPOST(req(body(), SECRETS[A]));
      migrate.mockImplementationOnce(async () => { throw new Error('reject'); });
      const r2 = await legacyPOST(req(body(), SECRETS[A]));
      await flush();
      for (const r of [r1, r2]) {
        expect(r.status).toBe(200);
        expect({ ...(await r.json()), processingTimeMs: 0 }).toEqual({ ...baseline, processingTimeMs: 0 });
      }
    });

    it('the response does not wait on the trigger', async () => {
      migrate.mockImplementation(() => new Promise<void>(() => {}));
      const res = await legacyPOST(req(body(), SECRETS[A]));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ processed: true });
    });
  });
});
