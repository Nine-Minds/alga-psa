import Stripe from 'stripe';
import { tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getConnection } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import type { IPaymentProviderConfig } from 'server/src/interfaces/payment.interfaces';

/**
 * Events we subscribe to for invoice payment processing and saved-card auto-pay.
 * These are automatically configured when connecting Stripe.
 */
export const STRIPE_WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'setup_intent.succeeded',
  'setup_intent.setup_failed',
  'payment_method.detached',
  'payment_method.updated',
  'payment_method.automatically_updated',
];

/** Legacy shared URL and the per-tenant URL (tenant identity comes from the route). */
export function stripeWebhookUrls(baseUrl: string, tenant: string): { legacyUrl: string; tenantUrl: string } {
  const legacyUrl = `${baseUrl}/api/webhooks/stripe/payments`;
  return { legacyUrl, tenantUrl: `${legacyUrl}/${tenant}` };
}

/** Same base URL resolution as the connect flow (payment-actions.ts). */
export function resolveStripeWebhookBaseUrl(): string {
  return (
    process.env.STRIPE_WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000'
  );
}

/**
 * Brings an existing tenant's Stripe webhook endpoint up to date: the per-tenant
 * URL and STRIPE_WEBHOOK_EVENTS.
 *
 * Idempotent: when the URL and events already match, no Stripe update is made.
 * A missing/deleted endpoint is logged and skipped; endpoints are never created
 * and signing secrets are never rotated (update does not change the secret).
 *
 * Server-internal: takes a trusted tenantId and performs no authorization, so it
 * must not be exported from a 'use server' module.
 */
export async function reconcileStripeWebhookEvents(
  tenant: string,
  options: { baseUrl?: string } = {}
): Promise<boolean> {
  const knex = await getConnection(tenant);
  const config = await tenantDb(knex, tenant).table<IPaymentProviderConfig>('payment_provider_configs')
    .where({ provider_type: 'stripe', is_enabled: true }).first();
  const endpointId = (config?.configuration as any)?.webhook_endpoint_id;
  if (!config || !endpointId) return false;
  const secretProvider = await getSecretProviderInstance();
  const secretKey = await secretProvider.getTenantSecret(tenant, 'stripe_payment_secret_key');
  if (!secretKey) return false;
  const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any });
  const { tenantUrl } = stripeWebhookUrls(options.baseUrl ?? resolveStripeWebhookBaseUrl(), tenant);

  let current: Stripe.WebhookEndpoint | Stripe.DeletedWebhookEndpoint;
  try {
    current = await stripe.webhookEndpoints.retrieve(endpointId);
  } catch (error: any) {
    if (error?.code === 'resource_missing' || error?.statusCode === 404) {
      logger.warn('[StripeWebhookReconcile] Webhook endpoint missing in Stripe; skipping', { tenantId: tenant, endpointId });
      return false;
    }
    throw error;
  }
  if ((current as any).deleted) {
    logger.warn('[StripeWebhookReconcile] Webhook endpoint deleted in Stripe; skipping', { tenantId: tenant, endpointId });
    return false;
  }
  const live = current as Stripe.WebhookEndpoint;
  const eventsMatch =
    JSON.stringify([...live.enabled_events].sort()) === JSON.stringify([...STRIPE_WEBHOOK_EVENTS].sort());
  if (live.url === tenantUrl && eventsMatch) return true;

  const endpoint = await stripe.webhookEndpoints.update(endpointId, {
    url: tenantUrl,
    enabled_events: STRIPE_WEBHOOK_EVENTS,
  });
  await tenantDb(knex, tenant).table('payment_provider_configs').where({ config_id: config.config_id }).update({
    configuration: { ...(config.configuration as any), webhook_events: endpoint.enabled_events }, updated_at: knex.fn.now(),
  });
  return true;
}

/**
 * Operational entry point: reconciles every tenant with an enabled Stripe config.
 * Failures are isolated per tenant. Returns counts only.
 */
export async function reconcileAllStripeWebhookEndpoints(
  options: { baseUrl?: string; tenants?: string[] } = {}
): Promise<{ total: number; reconciled: number; skipped: number; failed: string[] }> {
  let tenants = options.tenants;
  if (!tenants) {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const admin = await getAdminConnection();
    const rows = await tenantDb(admin, '__stripe_webhook_reconcile_all__')
      .unscoped('payment_provider_configs', 'enumerate enabled Stripe tenants for webhook endpoint migration')
      .where({ provider_type: 'stripe', is_enabled: true })
      .select('tenant');
    tenants = Array.from(new Set(rows.map((r: { tenant: string }) => r.tenant)));
  }
  const result = { total: tenants.length, reconciled: 0, skipped: 0, failed: [] as string[] };
  for (const tenant of tenants) {
    try {
      if (await reconcileStripeWebhookEvents(tenant, { baseUrl: options.baseUrl })) result.reconciled++;
      else result.skipped++;
    } catch (error) {
      logger.error('[StripeWebhookReconcile] Tenant failed', {
        tenantId: tenant,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed.push(tenant);
    }
  }
  return result;
}
