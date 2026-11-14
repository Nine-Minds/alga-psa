import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import {
  peekTenantId,
  resolveSignatureCandidates,
  verifyStripeSignature,
} from '../paymentsSignature';

const TENANT = '0ad8e710-13bc-4e01-a6ca-3f8992978ae8';
const TENANT_SECRET = 'whsec_tenant_endpoint_secret';
const PLATFORM_SECRET = 'whsec_platform_endpoint_secret';

function payload(metadata: Record<string, string> = {}): string {
  return JSON.stringify({
    id: 'evt_test',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test', object: 'checkout.session', metadata } },
  });
}

function sign(body: string, secret: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}

function provider(opts: { tenant?: Record<string, string>; app?: Record<string, string> }) {
  return {
    getAppSecret: async (name: string) => opts.app?.[name],
    getTenantSecret: async (tenantId: string, name: string) =>
      tenantId === TENANT ? opts.tenant?.[name] : undefined,
  };
}

describe('peekTenantId', () => {
  it('reads tenant_id from unverified metadata', () => {
    expect(peekTenantId(payload({ tenant_id: TENANT }))).toBe(TENANT);
  });

  it('returns null for missing metadata or malformed JSON', () => {
    expect(peekTenantId(payload())).toBeNull();
    expect(peekTenantId('not json')).toBeNull();
    expect(peekTenantId('{}')).toBeNull();
  });
});

const TENANT_B = '5b3f0f5e-7a7e-4c3e-9d0b-1f0a1c2d3e4f';
const B_SECRET = 'whsec_tenant_b';

describe('resolveSignatureCandidates', () => {
  const prov = {
    getAppSecret: async (name: string) => ({ stripe_webhook_secret: PLATFORM_SECRET } as Record<string, string>)[name],
    getTenantSecret: async (t: string) => ({ [TENANT]: TENANT_SECRET, [TENANT_B]: B_SECRET } as Record<string, string>)[t],
  };

  it('route tenant: only that tenant secret, never platform', async () => {
    expect(await resolveSignatureCandidates(prov, { tenantIdFromRoute: TENANT })).toEqual([
      { source: 'route-tenant', tenantId: TENANT, secret: TENANT_SECRET },
    ]);
  });

  it('legacy: hint first, then every enabled tenant (deduped), then platform', async () => {
    const c = await resolveSignatureCandidates(prov, {
      payloadTenantHint: TENANT_B,
      enabledTenantIds: [TENANT, TENANT_B],
    });
    expect(c.map((x) => [x.source, x.tenantId])).toEqual([
      ['hint-tenant', TENANT_B],
      ['tenant', TENANT],
      ['platform', null],
    ]);
  });

  it('skips tenants without a secret and de-duplicates identical secrets', async () => {
    const dup = { ...prov, getTenantSecret: async () => TENANT_SECRET };
    const c = await resolveSignatureCandidates(dup, { enabledTenantIds: [TENANT, TENANT_B] });
    expect(c.filter((x) => x.secret === TENANT_SECRET)).toHaveLength(1);
  });

  it('prefers stripe_payment_webhook_secret at app level and returns [] when nothing configured', async () => {
    const p = { getAppSecret: async (n: string) => (n === 'stripe_payment_webhook_secret' ? 'whsec_specific' : PLATFORM_SECRET), getTenantSecret: async () => undefined };
    expect((await resolveSignatureCandidates(p, {}))[0].secret).toBe('whsec_specific');
    expect(await resolveSignatureCandidates({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }, {})).toEqual([]);
  });
});

describe('verifyStripeSignature', () => {
  const cands = [
    { source: 'tenant' as const, tenantId: TENANT, secret: TENANT_SECRET },
    { source: 'platform' as const, tenantId: null, secret: PLATFORM_SECRET },
  ];

  it('verifies an untagged event for the signing tenant', () => {
    const body = payload();
    const r = verifyStripeSignature(body, sign(body, TENANT_SECRET), cands);
    expect(r).toMatchObject({ kind: 'verified', tenantId: TENANT, secretSource: 'tenant' });
  });

  it('verifies a platform-signed event with null tenant', () => {
    const body = payload();
    expect(verifyStripeSignature(body, sign(body, PLATFORM_SECRET), cands)).toMatchObject({ kind: 'verified', tenantId: null, secretSource: 'platform' });
  });

  it('ignores a payload tagged with a different tenant than the verified one', () => {
    const body = payload({ tenant_id: TENANT_B });
    expect(verifyStripeSignature(body, sign(body, TENANT_SECRET), cands)).toMatchObject({ kind: 'ignored', tenantId: TENANT, reason: 'tenant_mismatch' });
  });

  it('returns invalid for unknown secret or tampered signature', () => {
    const body = payload({ tenant_id: TENANT });
    expect(verifyStripeSignature(body, sign(body, 'whsec_other'), cands)).toEqual({ kind: 'invalid' });
    expect(verifyStripeSignature(body, 't=1,v1=deadbeef', cands)).toEqual({ kind: 'invalid' });
  });
});
