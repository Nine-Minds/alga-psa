'use server';

import { getSession } from '@alga-psa/auth';
import { getConnection } from '@/lib/db/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import Stripe from 'stripe';
import logger from '@alga-psa/core/logger';

export type ApplianceLicenseTier = 'pro' | 'premium';
export type ApplianceLicenseTransport = 'connected-monthly' | 'connected-annual' | 'airgap-annual';

export interface PurchaseApplianceLicenseInput {
  submissionId: string;
  clientId: string;
  tier: ApplianceLicenseTier;
  seats: number;
  transport: ApplianceLicenseTransport;
}

export interface PurchaseApplianceLicenseResult {
  checkoutUrl: string;
}

/** Map tier × transport to the env key that holds the Stripe price id. */
function getPriceEnvKey(tier: ApplianceLicenseTier, transport: ApplianceLicenseTransport): string {
  const map: Record<string, string> = {
    'pro:connected-monthly':  'STRIPE_APPLIANCE_PRO_CONNECTED_MONTHLY_PRICE_ID',
    'pro:connected-annual':   'STRIPE_APPLIANCE_PRO_CONNECTED_ANNUAL_PRICE_ID',
    'pro:airgap-annual':      'STRIPE_APPLIANCE_PRO_AIRGAP_ANNUAL_PRICE_ID',
    'premium:connected-monthly': 'STRIPE_APPLIANCE_PREMIUM_CONNECTED_MONTHLY_PRICE_ID',
    'premium:connected-annual':  'STRIPE_APPLIANCE_PREMIUM_CONNECTED_ANNUAL_PRICE_ID',
    'premium:airgap-annual':     'STRIPE_APPLIANCE_PREMIUM_AIRGAP_ANNUAL_PRICE_ID',
  };
  return map[`${tier}:${transport}`] ?? '';
}

async function getStripeSecretKey(): Promise<string> {
  const sp = await getSecretProviderInstance();
  const key = await sp.getAppSecret('stripe_secret_key') || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe secret key not configured');
  return key;
}

function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://localhost:3000';
}

/**
 * Creates a Stripe Checkout Session for an appliance license purchase.
 *
 * Called by the portal UI after the SR submission is created.
 * Stamps the submission_id + order params into session metadata so the
 * checkout.session.completed webhook can correlate back and fire issuance.
 */
export async function purchaseApplianceLicense(
  input: PurchaseApplianceLicenseInput
): Promise<PurchaseApplianceLicenseResult> {
  const session = await getSession();
  if (!session?.user) throw new Error('Unauthorized');

  const { submissionId, clientId, tier, seats, transport } = input;

  // Validate
  if (tier !== 'pro' && tier !== 'premium') throw new Error('Invalid tier');
  if (!Number.isInteger(seats) || seats < 1) throw new Error('seats must be a positive integer');
  if (!['connected-monthly', 'connected-annual', 'airgap-annual'].includes(transport)) {
    throw new Error('Invalid transport');
  }

  const priceEnvKey = getPriceEnvKey(tier, transport);
  const priceId = process.env[priceEnvKey];
  if (!priceId) {
    throw new Error(`Stripe price not configured for ${tier}:${transport} (env: ${priceEnvKey})`);
  }

  const secretKey = await getStripeSecretKey();
  const stripe = new Stripe(secretKey, { apiVersion: '2024-04-10' });

  const isSubscription = transport !== 'airgap-annual';
  const baseUrl = getAppBaseUrl();

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: isSubscription ? 'subscription' : 'payment',
    line_items: [{ price: priceId, quantity: seats }],
    success_url: `${baseUrl}/client-portal/licenses?checkout=success&submission_id=${submissionId}`,
    cancel_url:  `${baseUrl}/client-portal/licenses?checkout=cancelled`,
    metadata: {
      is_license_order: 'true',
      service_request_submission_id: submissionId,
      client_id: clientId,
      tier,
      seats: String(seats),
      transport,
    },
  });

  if (!checkoutSession.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  // Record the checkout session id on the submission
  const knex = await getConnection();
  await knex('service_request_submissions')
    .where({ submission_id: submissionId })
    .update({ workflow_execution_id: `stripe_session_${checkoutSession.id}`, updated_at: knex.fn.now() });

  logger.info('[applianceLicense] checkout session created', {
    submissionId,
    checkoutSessionId: checkoutSession.id,
    tier,
    seats,
    transport,
  });

  return { checkoutUrl: checkoutSession.url };
}
