import Stripe from 'stripe';
import { tenantDb } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getConnection } from 'server/src/lib/db/db';
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

/**
 * Brings an existing tenant's Stripe webhook endpoint up to STRIPE_WEBHOOK_EVENTS.
 *
 * Server-internal: takes a trusted tenantId and performs no authorization, so it
 * must not be exported from a 'use server' module.
 */
export async function reconcileStripeWebhookEvents(tenant: string): Promise<boolean> {
  const knex = await getConnection(tenant);
  const config = await tenantDb(knex, tenant).table<IPaymentProviderConfig>('payment_provider_configs')
    .where({ provider_type: 'stripe', is_enabled: true }).first();
  const endpointId = (config?.configuration as any)?.webhook_endpoint_id;
  if (!config || !endpointId) return false;
  const secretProvider = await getSecretProviderInstance();
  const secretKey = await secretProvider.getTenantSecret(tenant, 'stripe_payment_secret_key');
  if (!secretKey) return false;
  const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any });
  const endpoint = await stripe.webhookEndpoints.update(endpointId, { enabled_events: STRIPE_WEBHOOK_EVENTS });
  await tenantDb(knex, tenant).table('payment_provider_configs').where({ config_id: config.config_id }).update({
    configuration: { ...(config.configuration as any), webhook_events: endpoint.enabled_events }, updated_at: knex.fn.now(),
  });
  return true;
}
