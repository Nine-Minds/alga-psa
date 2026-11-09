import * as fs from 'fs';
import Stripe from 'stripe';
import { tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getConnection } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { stripeApiOverride } from '../stripe/stripeApiOverride';
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

// Path to ngrok URL file (written by ngrok-sync container)
const NGROK_URL_FILE = '/app/ngrok/url';

// Check if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

/**
 * Gets the base URL for Stripe webhooks.
 * Priority:
 * 1. Explicit STRIPE_WEBHOOK_BASE_URL override
 * 2. ngrok URL file in development mode
 * 3. NEXT_PUBLIC_APP_URL / NEXTAUTH_URL / APP_BASE_URL fallback
 */
export const getStripeBaseUrl = (): string => {
  // If explicitly set, use that
  if (process.env.STRIPE_WEBHOOK_BASE_URL) {
    return process.env.STRIPE_WEBHOOK_BASE_URL;
  }

  // In development mode, check for ngrok URL file first
  if (isDevelopment) {
    try {
      if (fs.existsSync(NGROK_URL_FILE)) {
        const ngrokUrl = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
        if (ngrokUrl) {
          console.log(`[PaymentActions] Using ngrok URL for Stripe webhook: ${ngrokUrl}`);
          return ngrokUrl;
        }
      }
    } catch (error) {
      // Ignore file read errors, fall back to env vars
      console.debug('[PaymentActions] Could not read ngrok URL file, using environment variables');
    }
  }

  // Fall back to environment variables
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
};

/**
 * Brings an existing tenant's Stripe webhook endpoint up to date: the per-tenant
 * URL and STRIPE_WEBHOOK_EVENTS.
 *
 * `options.scope` (default 'full'):
 * - 'full': URL + events, and the stored `webhook_events` is refreshed.
 * - 'url': only the URL is moved (`update(id, { url })`, no `enabled_events`).
 *   Event differences are ignored and the stored config is not rewritten.
 *   Used by the on-demand legacy-route migration, which must not alter what a
 *   tenant's endpoint subscribes to.
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
  options: { baseUrl?: string; scope?: 'url' | 'full' } = {}
): Promise<boolean> {
  const urlOnly = options.scope === 'url';
  const knex = await getConnection(tenant);
  const config = await tenantDb(knex, tenant).table<IPaymentProviderConfig>('payment_provider_configs')
    .where({ provider_type: 'stripe', is_enabled: true }).first();
  const endpointId = (config?.configuration as any)?.webhook_endpoint_id;
  if (!config || !endpointId) return false;
  const secretProvider = await getSecretProviderInstance();
  const secretKey = await secretProvider.getTenantSecret(tenant, 'stripe_payment_secret_key');
  if (!secretKey) return false;
  // LEVERAGE: pattern stripe-client — tenant Stripe clients are built ad hoc here, in payment-actions.ts and StripePaymentProvider (each with or without the emulator override); a shared tenant-client factory would end the drift.
  const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any, ...stripeApiOverride(secretKey) });
  const { tenantUrl } = stripeWebhookUrls(options.baseUrl ?? getStripeBaseUrl(), tenant);

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
  if (urlOnly) {
    if (live.url === tenantUrl) return true;
    await stripe.webhookEndpoints.update(endpointId, { url: tenantUrl });
    logger.info('[StripeWebhookReconcile] Webhook endpoint URL moved to per-tenant route', { tenantId: tenant, endpointId });
    return true;
  }
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

// ── On-demand migration (triggered by legacy-route deliveries) ───────────────

/** How long a tenant is left alone after a completed (non-failed) attempt. */
export const ON_DEMAND_MIGRATION_TTL_MS = 10 * 60 * 1000;

// LEVERAGE: pattern fire-dedupe-swallow — single-flight + TTL marker + swallow-errors shape; check other fire-and-forget background triggers before adding a third copy.
const inFlight = new Set<string>();
const recentlyDone = new Map<string, number>();

/** Test hook: clears single-flight and TTL state. */
export function resetOnDemandMigrationState(): void {
  inFlight.clear();
  recentlyDone.clear();
}

/**
 * Base-URL guard. Returns a reason to skip, or null when the URL is safe to
 * register with Stripe. "Production" is NODE_ENV === 'production'.
 */
function baseUrlSkipReason(baseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return 'unparseable base URL';
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'base URL host is loopback';
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return 'base URL is not https in production';
  return null;
}

/**
 * Moves tenant's Stripe webhook endpoint to the per-tenant URL (URL only).
 * Fire-and-forget: never throws. Single-flight per tenant; completed attempts
 * (including "nothing to do") are remembered in-process for
 * ON_DEMAND_MIGRATION_TTL_MS so steady legacy traffic does not retrieve on
 * every delivery; failed attempts are not remembered, so the next legacy
 * delivery retries. In-process only: each replica may do one attempt per TTL,
 * which is harmless because the update is idempotent.
 */
export async function migrateStripeWebhookEndpointOnDemand(tenantId: string): Promise<void> {
  if (inFlight.has(tenantId)) return;
  const doneAt = recentlyDone.get(tenantId);
  if (doneAt !== undefined && Date.now() - doneAt < ON_DEMAND_MIGRATION_TTL_MS) return;
  inFlight.add(tenantId);
  try {
    const baseUrl = getStripeBaseUrl();
    const skip = baseUrlSkipReason(baseUrl);
    if (skip) {
      logger.warn('[StripeWebhookReconcile] On-demand migration skipped', { tenantId, reason: skip });
    } else {
      const moved = await reconcileStripeWebhookEvents(tenantId, { baseUrl, scope: 'url' });
      logger.info('[StripeWebhookReconcile] On-demand migration attempt finished', { tenantId, endpointFound: moved });
    }
    recentlyDone.set(tenantId, Date.now());
  } catch (error) {
    logger.error('[StripeWebhookReconcile] On-demand migration failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    inFlight.delete(tenantId);
  }
}
