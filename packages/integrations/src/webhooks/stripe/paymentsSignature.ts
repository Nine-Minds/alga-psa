import Stripe from 'stripe';
import type { ISecretProvider } from '@alga-psa/core/secrets';

/**
 * Signature handling for the invoice-payments Stripe webhook.
 *
 * Two kinds of Stripe accounts deliver to /api/webhooks/stripe/payments:
 *
 * - A tenant's own connected Stripe account. When a tenant connects Stripe,
 *   Alga creates a webhook endpoint in *their* account and stores that
 *   endpoint's signing secret as the tenant secret `stripe_payment_webhook_secret`.
 *   Events from that account are signed with the tenant's endpoint secret.
 * - The platform (Nine Minds) Stripe account, whose endpoint secret lives in the
 *   app-level secret `stripe_payment_webhook_secret` (falling back to
 *   `stripe_webhook_secret`). License orders arrive this way.
 *
 * Tenant identity comes from the ROUTE (per-tenant endpoint) or, on the legacy
 * shared route, from whichever tenant's secret verifies the signature. The
 * unverified payload's metadata.tenant_id is only an ordering hint; after a
 * signature verifies, a payload tenant that differs from the verified tenant
 * is ignored, never re-routed.
 */

export type WebhookSecretSource = 'route-tenant' | 'hint-tenant' | 'tenant' | 'platform';

export interface WebhookSecretCandidate {
  source: WebhookSecretSource;
  /** Tenant the secret belongs to; null for the platform secret. */
  tenantId: string | null;
  secret: string;
}

export type StripeSignatureResult =
  | { kind: 'verified'; event: Stripe.Event; tenantId: string | null; secretSource: WebhookSecretSource }
  | { kind: 'ignored'; event: Stripe.Event; tenantId: string; secretSource: WebhookSecretSource; reason: 'tenant_mismatch' }
  | { kind: 'invalid' };

export const TENANT_WEBHOOK_SECRET_NAME = 'stripe_payment_webhook_secret';
export const PLATFORM_WEBHOOK_SECRET_NAMES = ['stripe_payment_webhook_secret', 'stripe_webhook_secret'] as const;

/**
 * Extracts tenant_id from Stripe event metadata. Works on both verified events
 * and the raw parsed payload (same shape).
 */
export function extractTenantId(event: Pick<Stripe.Event, 'type' | 'data'>): string | null {
  const obj = event.data?.object as { metadata?: Record<string, string | undefined> } | undefined;
  const tenantId = obj?.metadata?.tenant_id;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null;
}

/**
 * Best-effort, pre-verification read of the tenant id from the raw body.
 * Returns null on malformed JSON or missing metadata; never throws.
 */
export function peekTenantId(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as Partial<Stripe.Event>;
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null;
    return extractTenantId(parsed as Pick<Stripe.Event, 'type' | 'data'>);
  } catch {
    return null;
  }
}

export interface ResolveSignatureCandidatesInput {
  /** Tenant fixed by the per-tenant route. When set, ONLY that tenant's secret is a candidate. */
  tenantIdFromRoute?: string;
  /** Unverified metadata.tenant_id from the payload; used purely to order candidates. */
  payloadTenantHint?: string | null;
  /** Tenants whose endpoint secret may sign legacy-route deliveries (enabled Stripe tenants). */
  enabledTenantIds?: string[];
}

/**
 * Resolves the ordered, de-duplicated list of signing secrets to try.
 *
 * - Per-tenant route: exactly that tenant's secret (no platform, no hint).
 * - Legacy route: hint tenant, then every enabled tenant, then the platform secret.
 */
export async function resolveSignatureCandidates(
  secretProvider: Pick<ISecretProvider, 'getAppSecret' | 'getTenantSecret'>,
  input: ResolveSignatureCandidatesInput = {}
): Promise<WebhookSecretCandidate[]> {
  const candidates: WebhookSecretCandidate[] = [];
  const seen = new Set<string>();
  const add = (source: WebhookSecretSource, tenantId: string | null, secret: string | undefined | null) => {
    if (!secret || seen.has(secret)) return;
    seen.add(secret);
    candidates.push({ source, tenantId, secret });
  };
  const tenantSecret = async (tenantId: string) => {
    try {
      return await secretProvider.getTenantSecret(tenantId, TENANT_WEBHOOK_SECRET_NAME);
    } catch {
      return undefined;
    }
  };

  if (input.tenantIdFromRoute) {
    add('route-tenant', input.tenantIdFromRoute, await tenantSecret(input.tenantIdFromRoute));
    return candidates;
  }

  if (input.payloadTenantHint) {
    add('hint-tenant', input.payloadTenantHint, await tenantSecret(input.payloadTenantHint));
  }

  const others = (input.enabledTenantIds ?? []).filter((t) => t !== input.payloadTenantHint);
  const secrets = await Promise.all(others.map(tenantSecret));
  others.forEach((tenantId, i) => add('tenant', tenantId, secrets[i]));

  for (const name of PLATFORM_WEBHOOK_SECRET_NAMES) {
    const platformSecret = await secretProvider.getAppSecret(name);
    if (platformSecret) {
      add('platform', null, platformSecret);
      break;
    }
  }

  return candidates;
}

/**
 * Verifies the Stripe signature with Stripe's own constructEvent, once per
 * candidate in order; the first match wins. A verified event whose
 * metadata.tenant_id names a different tenant than the one whose secret signed
 * it is reported as `ignored`. Nothing about failed candidates is exposed.
 */
export function verifyStripeSignature(
  rawBody: string,
  signature: string,
  candidates: WebhookSecretCandidate[]
): StripeSignatureResult {
  for (const candidate of candidates) {
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(rawBody, signature, candidate.secret);
    } catch {
      continue;
    }
    const payloadTenant = extractTenantId(event);
    if (candidate.tenantId && payloadTenant && payloadTenant !== candidate.tenantId) {
      return {
        kind: 'ignored',
        event,
        tenantId: candidate.tenantId,
        secretSource: candidate.source,
        reason: 'tenant_mismatch',
      };
    }
    return { kind: 'verified', event, tenantId: candidate.tenantId, secretSource: candidate.source };
  }
  return { kind: 'invalid' };
}
