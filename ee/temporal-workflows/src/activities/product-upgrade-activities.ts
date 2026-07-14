import { ApplicationFailure, Context } from '@temporalio/activity';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import Stripe from 'stripe';
import {
  applyRbacDelta,
  backfillClientTaxDefaults,
  backfillPsaSeeds,
  ensureSlaParity,
  flipProductCode,
  preflightProductUpgrade,
  verifyProductUpgrade,
} from '../db/product-upgrade-operations.js';
import type { SeedRunLog } from '../db/onboarding-seeds-operations.js';

interface ProductUpgradeSubscriptionRow {
  stripe_subscription_external_id: string;
  stripe_subscription_item_id: string | null;
  stripe_price_id: string;
  status: string;
  quantity: number;
  metadata: Record<string, unknown> | null;
}

interface StripePriceRow {
  stripe_price_id: string;
  stripe_price_external_id: string;
}

interface StripePriceConfig {
  algadeskMonthly: string;
  algadeskAnnual: string;
  algapsaMonthly: string;
  algapsaAnnual: string;
}

export interface ProductUpgradeStripeClient {
  subscriptions: {
    retrieve(subscriptionId: string): Promise<Stripe.Subscription>;
    update(
      subscriptionId: string,
      params: Stripe.SubscriptionUpdateParams,
    ): Promise<Stripe.Subscription>;
  };
}

export interface ProductUpgradeStripeSwapDependencies {
  stripe?: ProductUpgradeStripeClient;
  env?: NodeJS.ProcessEnv;
  log?: SeedRunLog;
  loadCanonicalSubscription?: (
    tenantId: string,
    knownPriceIds: readonly string[],
  ) => Promise<ProductUpgradeSubscriptionRow | null>;
}

export interface ProductUpgradeStripeSwapResult {
  swapped: boolean;
  reason?: string;
}

const REFUSAL_ERROR_TYPE = 'ProductUpgradeStripeRefusal';
let stripeClient: Stripe | null = null;

function activityLog(): SeedRunLog {
  return Context.current().log;
}

function refuse(message: string, reason: string): never {
  throw ApplicationFailure.nonRetryable(message, REFUSAL_ERROR_TYPE, reason);
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    refuse(`${key} is not configured in the temporal worker`, 'missing-configuration');
  }
  return value;
}

function readStripePriceConfig(env: NodeJS.ProcessEnv): StripePriceConfig {
  return {
    algadeskMonthly: requiredEnv(env, 'STRIPE_ALGADESK_USER_PRICE_ID'),
    algadeskAnnual: requiredEnv(env, 'STRIPE_ALGADESK_USER_ANNUAL_PRICE_ID'),
    algapsaMonthly: requiredEnv(env, 'STRIPE_ALGAPSA_USER_PRICE_ID'),
    algapsaAnnual: requiredEnv(env, 'STRIPE_ALGAPSA_USER_ANNUAL_PRICE_ID'),
  };
}

function defaultStripeClient(env: NodeJS.ProcessEnv): Stripe {
  if (stripeClient) return stripeClient;

  const secretKey = requiredEnv(env, 'STRIPE_SECRET_KEY');
  stripeClient = new Stripe(secretKey, {
    apiVersion: '2024-12-18.acacia' as any,
    typescript: true,
  });
  return stripeClient;
}

async function loadCanonicalActiveLicenseSubscription(
  tenantId: string,
  knownPriceIds: readonly string[],
): Promise<ProductUpgradeSubscriptionRow | null> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenantId);
  const candidates = await db.table<ProductUpgradeSubscriptionRow>('stripe_subscriptions')
    .where('status', 'active')
    .whereRaw("COALESCE(metadata->>'addon_key', '') = ''")
    .select(
      'stripe_subscription_external_id',
      'stripe_subscription_item_id',
      'stripe_price_id',
      'status',
      'quantity',
      'metadata',
    );

  if (candidates.length <= 1) return candidates[0] ?? null;

  const priceRows = await db
    .unscoped<StripePriceRow>(
      'stripe_prices',
      'map globally unique price ids referenced by tenant-scoped subscriptions',
    )
    .whereIn('stripe_price_id', candidates.map(candidate => candidate.stripe_price_id))
    .select('stripe_price_id', 'stripe_price_external_id');
  const externalPriceById = new Map(
    priceRows.map(price => [price.stripe_price_id, price.stripe_price_external_id]),
  );
  const knownPrices = new Set(knownPriceIds);

  return candidates.find(candidate =>
    knownPrices.has(externalPriceById.get(candidate.stripe_price_id) ?? '')) ?? candidates[0];
}

export async function product_upgrade_preflight(tenantId: string) {
  return preflightProductUpgrade(tenantId, activityLog());
}

export async function product_upgrade_backfill_seeds(tenantId: string) {
  return backfillPsaSeeds(tenantId, activityLog());
}

export async function product_upgrade_rbac_delta(tenantId: string): Promise<void> {
  return applyRbacDelta(tenantId, activityLog());
}

export async function product_upgrade_client_backfill(tenantId: string) {
  return backfillClientTaxDefaults(tenantId, activityLog());
}

export async function product_upgrade_sla_parity(tenantId: string) {
  return ensureSlaParity(tenantId, activityLog());
}

export async function product_upgrade_stripe_swap(
  tenantId: string,
  dependencies: ProductUpgradeStripeSwapDependencies = {},
): Promise<ProductUpgradeStripeSwapResult> {
  const env = dependencies.env ?? process.env;
  const log = dependencies.log ?? activityLog();
  const prices = readStripePriceConfig(env);
  const knownPriceIds = Object.values(prices);
  const loadSubscription = dependencies.loadCanonicalSubscription
    ?? loadCanonicalActiveLicenseSubscription;
  const subscriptionRow = await loadSubscription(tenantId, knownPriceIds);

  if (!subscriptionRow) {
    refuse(
      `Tenant ${tenantId} has no active canonical license subscription`,
      'no-active-license-subscription',
    );
  }
  if (!subscriptionRow.stripe_subscription_external_id) {
    refuse(`Tenant ${tenantId} license subscription has no Stripe id`, 'missing-subscription-id');
  }
  if (!subscriptionRow.stripe_subscription_item_id) {
    refuse(`Tenant ${tenantId} license subscription has no user item id`, 'missing-user-item');
  }

  const stripe = dependencies.stripe ?? defaultStripeClient(env);
  const subscription = await stripe.subscriptions.retrieve(
    subscriptionRow.stripe_subscription_external_id,
  );

  if (subscription.status !== 'active') {
    refuse(
      `Stripe subscription ${subscription.id} is ${subscription.status}, expected active`,
      'subscription-not-active',
    );
  }

  const userItem = subscription.items.data.find(
    item => item.id === subscriptionRow.stripe_subscription_item_id,
  );
  if (!userItem) {
    refuse(
      `Stripe subscription ${subscription.id} does not contain its canonical user item`,
      'user-item-not-found',
    );
  }

  const interval = userItem.price.recurring?.interval;
  if (interval !== 'month' && interval !== 'year') {
    refuse(
      `Stripe subscription ${subscription.id} user item has unsupported billing interval`,
      'unsupported-interval',
    );
  }

  const sourcePrice = interval === 'year' ? prices.algadeskAnnual : prices.algadeskMonthly;
  const targetPrice = interval === 'year' ? prices.algapsaAnnual : prices.algapsaMonthly;
  if (userItem.price.id === targetPrice) {
    log.info('Stripe subscription is already on the AlgaPSA price', {
      tenantId,
      subscriptionId: subscription.id,
      interval,
    });
    return { swapped: false, reason: 'already-target' };
  }
  if (userItem.price.id !== sourcePrice) {
    refuse(
      `Stripe subscription ${subscription.id} user item is not on the configured AlgaDesk ${interval} price`,
      'unknown-source-price',
    );
  }
  if (!Number.isSafeInteger(userItem.quantity) || (userItem.quantity ?? 0) < 0) {
    refuse(
      `Stripe subscription ${subscription.id} user item has no safe quantity to preserve`,
      'invalid-user-item-quantity',
    );
  }

  await stripe.subscriptions.update(subscription.id, {
    items: [{
      id: userItem.id,
      price: targetPrice,
      // quantity omitted: Stripe preserves the live quantity on a price-only change
    }],
    proration_behavior: 'always_invoice',
    metadata: { product_code: 'psa' },
  });

  log.info('Stripe subscription swapped to the AlgaPSA price', {
    tenantId,
    subscriptionId: subscription.id,
    interval,
    quantity: userItem.quantity,
  });
  return { swapped: true };
}

export async function product_upgrade_flip(tenantId: string): Promise<void> {
  return flipProductCode(tenantId, activityLog());
}

export async function product_upgrade_verify(tenantId: string): Promise<void> {
  return verifyProductUpgrade(tenantId, activityLog());
}
