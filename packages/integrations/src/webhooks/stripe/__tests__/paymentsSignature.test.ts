import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import {
  peekTenantId,
  resolveWebhookSecretCandidates,
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

describe('resolveWebhookSecretCandidates', () => {
  it('prefers the tenant endpoint secret, then the platform secret', async () => {
    const candidates = await resolveWebhookSecretCandidates(
      provider({
        tenant: { stripe_payment_webhook_secret: TENANT_SECRET },
        app: { stripe_webhook_secret: PLATFORM_SECRET },
      }),
      TENANT
    );
    expect(candidates).toEqual([
      { source: 'tenant', secret: TENANT_SECRET },
      { source: 'platform', secret: PLATFORM_SECRET },
    ]);
  });

  it('falls back to stripe_webhook_secret when the payment-specific app secret is absent', async () => {
    const candidates = await resolveWebhookSecretCandidates(
      provider({ app: { stripe_webhook_secret: PLATFORM_SECRET } }),
      null
    );
    expect(candidates).toEqual([{ source: 'platform', secret: PLATFORM_SECRET }]);
  });

  it('prefers stripe_payment_webhook_secret over stripe_webhook_secret at app level', async () => {
    const candidates = await resolveWebhookSecretCandidates(
      provider({ app: { stripe_payment_webhook_secret: 'whsec_specific', stripe_webhook_secret: PLATFORM_SECRET } }),
      null
    );
    expect(candidates).toEqual([{ source: 'platform', secret: 'whsec_specific' }]);
  });

  it('returns no candidates when nothing is configured', async () => {
    expect(await resolveWebhookSecretCandidates(provider({}), TENANT)).toEqual([]);
  });
});

describe('verifyStripeSignature', () => {
  const tenantCandidates = [
    { source: 'tenant' as const, secret: TENANT_SECRET },
    { source: 'platform' as const, secret: PLATFORM_SECRET },
  ];

  it('verifies an event signed by the tenant endpoint secret', () => {
    const body = payload({ tenant_id: TENANT });
    const result = verifyStripeSignature(body, sign(body, TENANT_SECRET), tenantCandidates);
    expect(result?.source).toBe('tenant');
    expect(result?.event.id).toBe('evt_test');
  });

  it('verifies an event signed by the platform secret', () => {
    const body = payload({ tenant_id: TENANT });
    const result = verifyStripeSignature(body, sign(body, PLATFORM_SECRET), tenantCandidates);
    expect(result?.source).toBe('platform');
  });

  it('rejects an event signed with an unknown secret', () => {
    const body = payload({ tenant_id: TENANT });
    expect(verifyStripeSignature(body, sign(body, 'whsec_other'), tenantCandidates)).toBeNull();
  });

  it('rejects a payload whose claimed tenant does not match the signing secret', () => {
    // Attacker claims a tenant id but cannot produce that tenant's signature.
    const body = payload({ tenant_id: TENANT });
    expect(verifyStripeSignature(body, 't=1,v1=deadbeef', tenantCandidates)).toBeNull();
  });
});
