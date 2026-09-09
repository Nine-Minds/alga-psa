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
 * The tenant id is read from the unverified payload only to decide which
 * secret(s) to try; nothing from the payload is trusted until a signature
 * verifies against one of them.
 */

export type WebhookSecretSource = 'tenant' | 'platform';

export interface WebhookSecretCandidate {
  source: WebhookSecretSource;
  secret: string;
}

export interface VerifiedStripeEvent {
  event: Stripe.Event;
  source: WebhookSecretSource;
}

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

/**
 * Resolves the signing secrets to try, tenant secret first when a tenant hint
 * is present, then the platform secret.
 */
export async function resolveWebhookSecretCandidates(
  secretProvider: Pick<ISecretProvider, 'getAppSecret' | 'getTenantSecret'>,
  tenantHint: string | null
): Promise<WebhookSecretCandidate[]> {
  const candidates: WebhookSecretCandidate[] = [];

  if (tenantHint) {
    const tenantSecret = await secretProvider.getTenantSecret(tenantHint, TENANT_WEBHOOK_SECRET_NAME);
    if (tenantSecret) {
      candidates.push({ source: 'tenant', secret: tenantSecret });
    }
  }

  for (const name of PLATFORM_WEBHOOK_SECRET_NAMES) {
    const platformSecret = await secretProvider.getAppSecret(name);
    if (platformSecret) {
      if (!candidates.some((c) => c.secret === platformSecret)) {
        candidates.push({ source: 'platform', secret: platformSecret });
      }
      break;
    }
  }

  return candidates;
}

/**
 * Verifies the Stripe signature against each candidate in order and returns
 * the constructed event plus which secret matched. Returns null when no
 * candidate verifies.
 */
export function verifyStripeSignature(
  rawBody: string,
  signature: string,
  candidates: WebhookSecretCandidate[]
): VerifiedStripeEvent | null {
  for (const candidate of candidates) {
    try {
      const event = Stripe.webhooks.constructEvent(rawBody, signature, candidate.secret);
      return { event, source: candidate.source };
    } catch {
      // try the next candidate
    }
  }
  return null;
}
