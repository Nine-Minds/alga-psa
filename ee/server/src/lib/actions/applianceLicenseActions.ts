'use server';

import { getSession } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { isLicenseDistributionTenant } from '@alga-psa/licensing';
import Stripe from 'stripe';
import type { Knex } from 'knex';
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

/** Context-driven inputs for {@link createApplianceLicenseCheckout}. */
export interface CreateApplianceLicenseCheckoutInput {
  knex: Knex;
  tenant: string;
  submissionId: string;
  clientId: string;
  tier: ApplianceLicenseTier;
  seats: number;
  transport: ApplianceLicenseTransport;
}

export interface ApplianceLicenseCheckout {
  checkoutUrl: string;
  checkoutSessionId: string;
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
 * Context-driven: the caller supplies `knex`/`tenant` and the already-validated
 * order params (the SR submission has already authenticated the requester), so
 * this does NOT re-auth. Stamps the submission_id + order params into session
 * metadata so the `checkout.session.completed` webhook can correlate back and
 * fire issuance. Persistence of the session id onto the submission is the
 * caller's responsibility (the SR submit service overwrites
 * `workflow_execution_id` from the execution result, so the provider returns the
 * stamp rather than writing it here).
 */
export async function createApplianceLicenseCheckout(
  input: CreateApplianceLicenseCheckoutInput
): Promise<ApplianceLicenseCheckout> {
  const { submissionId, clientId, tier, seats, transport } = input;

  // Hard gate: only the Nine Minds distribution tenant may create a license
  // checkout. This is the execution-layer chokepoint — it holds no matter how a
  // definition was authored (template, manual execution-provider selection, or a
  // direct action call), so another tenant can never run Checkout sessions
  // against Nine Minds' Stripe account.
  if (!isLicenseDistributionTenant(input.tenant)) {
    throw new Error('Appliance license checkout is not available for this tenant');
  }

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
  const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any });

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

  logger.info('[applianceLicense] checkout session created', {
    submissionId,
    checkoutSessionId: checkoutSession.id,
    tier,
    seats,
    transport,
  });

  return { checkoutUrl: checkoutSession.url, checkoutSessionId: checkoutSession.id };
}

/**
 * Authenticated direct-call entry: creates the checkout for the current session's
 * user and records the `stripe_session_<id>` stamp on the submission. The wired
 * path is the `license-order-stripe` SR execution provider (which calls
 * {@link createApplianceLicenseCheckout} and returns the stamp through the submit
 * service); this wrapper remains for any UI that creates the checkout directly.
 */
export async function purchaseApplianceLicense(
  input: PurchaseApplianceLicenseInput
): Promise<PurchaseApplianceLicenseResult> {
  const session = await getSession();
  if (!session?.user) throw new Error('Unauthorized');

  const { knex, tenant } = await createTenantKnex();
  const { checkoutUrl, checkoutSessionId } = await createApplianceLicenseCheckout({
    knex,
    tenant,
    submissionId: input.submissionId,
    clientId: input.clientId,
    tier: input.tier,
    seats: input.seats,
    transport: input.transport,
  });

  await knex('service_request_submissions')
    .where({ submission_id: input.submissionId, tenant })
    .update({ workflow_execution_id: `stripe_session_${checkoutSessionId}`, updated_at: knex.fn.now() });

  return { checkoutUrl };
}
