import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Knex } from 'knex';
import type Stripe from 'stripe';

import { findOrCreateAccount } from '../accounts/accounts.js';
import { recordAutoTopupFailure } from '../autoTopup/worker.js';
import type { AiAccountRow, AutoTopupJobRow, DeploymentType } from '../db/types.js';
import type { GatewayEventEmitter, GatewayEventInput } from '../events/events.js';
import { grantTopup, renewMonthlyCycle } from '../ledger/ledger.js';
import { HttpError } from '../http/errors.js';
import { resolveTopupPack, type TierConfigLoader } from '../tier/tierConfig.js';
import type { GatewayStripeClient } from './stripeClient.js';

const AUTO_TOPUP_RETRY_BASE_MS = 60_000;

function expandableId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.trim()
  ) {
    return value.id;
  }
  return undefined;
}

function deploymentType(value: string | undefined): DeploymentType {
  if (value !== 'hosted' && value !== 'appliance') {
    throw new Error('Stripe metadata.deployment_type must be hosted or appliance');
  }
  return value;
}

function requiredMetadata(
  metadata: Stripe.Metadata | null,
): { tenantId: string; deploymentType: DeploymentType } {
  const tenantId = metadata?.tenant_id?.trim();
  if (!tenantId) {
    throw new Error('Stripe metadata.tenant_id is required');
  }
  return { tenantId, deploymentType: deploymentType(metadata?.deployment_type) };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const parentSubscription = invoice.parent?.subscription_details?.subscription;
  if (parentSubscription) {
    return expandableId(parentSubscription);
  }
  return expandableId((invoice as Stripe.Invoice & { subscription?: unknown }).subscription);
}

async function subscriptionFromCheckout(
  session: Stripe.Checkout.Session,
  stripe: GatewayStripeClient,
): Promise<Stripe.Subscription> {
  if (
    typeof session.subscription === 'object' &&
    session.subscription !== null &&
    !('deleted' in session.subscription)
  ) {
    return session.subscription;
  }
  const subscriptionId = expandableId(session.subscription);
  if (!subscriptionId) {
    throw new Error(`AI add-on checkout ${session.id} has no subscription`);
  }
  return stripe.retrieveSubscription(subscriptionId);
}

async function findBoundAccount(
  database: Knex,
  subscriptionId: string,
): Promise<AiAccountRow | undefined> {
  return database<AiAccountRow>('ai_accounts')
    .where({ stripe_subscription_id: subscriptionId })
    .first();
}

async function processCheckoutCompleted(options: {
  database: Knex;
  session: Stripe.Checkout.Session;
  stripe: GatewayStripeClient;
  getTierConfig: TierConfigLoader;
}): Promise<GatewayEventInput[]> {
  const purpose = options.session.metadata?.purpose;
  if (purpose !== 'ai-addon' && purpose !== 'ai-topup') {
    return [];
  }
  const identity = requiredMetadata(options.session.metadata);
  const account = await findOrCreateAccount(
    options.database,
    identity,
    options.getTierConfig,
  );

  if (purpose === 'ai-addon') {
    const subscription = await subscriptionFromCheckout(options.session, options.stripe);
    const customerId = expandableId(options.session.customer) ?? expandableId(subscription.customer);
    if (!customerId) {
      throw new Error(`AI add-on checkout ${options.session.id} has no customer`);
    }
    await options.database('ai_accounts').where({ account_id: account.account_id }).update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      updated_at: new Date(),
    });
    return [];
  }

  const paymentIntentId = expandableId(options.session.payment_intent);
  if (!paymentIntentId) {
    throw new Error(`AI top-up checkout ${options.session.id} has no PaymentIntent`);
  }
  const priceId = await options.stripe.getCheckoutPriceId(options.session.id);
  const pack = resolveTopupPack(await options.getTierConfig(), priceId);
  await grantTopup(options.database, {
    accountId: account.account_id,
    credits: pack.credits,
    stripeRef: paymentIntentId,
    note: `Stripe checkout ${options.session.id}`,
  });
  const customerId = expandableId(options.session.customer);
  if (customerId) {
    await options.database('ai_accounts').where({ account_id: account.account_id }).update({
      stripe_customer_id: customerId,
      updated_at: new Date(),
    });
  }
  return [];
}

async function processInvoicePaid(options: {
  database: Knex;
  invoice: Stripe.Invoice;
  getTierConfig: TierConfigLoader;
}): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(options.invoice);
  if (!subscriptionId) {
    return;
  }
  const account = await findBoundAccount(options.database, subscriptionId);
  if (!account) {
    return;
  }
  const tier = await options.getTierConfig();
  await renewMonthlyCycle(options.database, {
    accountId: account.account_id,
    monthlyAllotment: tier.monthlyIncludedCredits,
    cycleStartedAt: new Date(options.invoice.period_start * 1_000),
    stripeRef: options.invoice.id,
    note: `Stripe invoice ${options.invoice.id}`,
  });
}

async function updateSubscriptionStatus(options: {
  database: Knex;
  subscription: Stripe.Subscription;
  status?: string;
}): Promise<void> {
  const customerId = expandableId(options.subscription.customer);
  await options.database('ai_accounts')
    .where({ stripe_subscription_id: options.subscription.id })
    .update({
      subscription_status: options.status ?? options.subscription.status,
      ...(customerId ? { stripe_customer_id: customerId } : {}),
      updated_at: new Date(),
    });
}

async function processInvoiceFailed(options: {
  database: Knex;
  invoice: Stripe.Invoice;
  stripe: GatewayStripeClient;
}): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(options.invoice);
  if (!subscriptionId || !(await findBoundAccount(options.database, subscriptionId))) {
    return;
  }
  await updateSubscriptionStatus({
    database: options.database,
    subscription: await options.stripe.retrieveSubscription(subscriptionId),
  });
}

async function processAutoTopupSucceeded(options: {
  database: Knex;
  paymentIntent: Stripe.PaymentIntent;
  getTierConfig: TierConfigLoader;
}): Promise<GatewayEventInput[]> {
  const jobId = options.paymentIntent.metadata.auto_topup_job_id?.trim();
  if (
    options.paymentIntent.metadata.purpose !== 'ai-topup' ||
    options.paymentIntent.metadata.source !== 'auto-topup' ||
    !jobId
  ) {
    return [];
  }
  const job = await options.database<AutoTopupJobRow>('auto_topup_jobs')
    .where({ job_id: jobId })
    .first();
  if (!job) {
    throw new Error(`Auto top-up job ${jobId} does not exist`);
  }
  const account = await options.database<AiAccountRow>('ai_accounts')
    .where({ account_id: job.account_id })
    .first();
  if (!account) {
    throw new Error(`Auto top-up account ${job.account_id} does not exist`);
  }
  const pack = resolveTopupPack(await options.getTierConfig(), job.pack_price_id);
  const grant = await grantTopup(options.database, {
    accountId: account.account_id,
    credits: pack.credits,
    stripeRef: options.paymentIntent.id,
    note: `Automatic top-up job ${job.job_id}`,
  });
  await options.database('auto_topup_jobs').where({ job_id: job.job_id }).update({
    status: 'succeeded',
    payment_intent_id: options.paymentIntent.id,
    last_error: null,
    locked_at: null,
    completed_at: new Date(),
    updated_at: new Date(),
  });
  await options.database('ai_accounts').where({ account_id: account.account_id }).update({
    auto_topup_failure_count: 0,
    updated_at: new Date(),
  });
  return grant.applied
    ? [
        {
          type: 'auto_topup_succeeded',
          accountId: account.account_id,
          tenantId: account.tenant_id,
          deploymentType: account.deployment_type,
          details: {
            jobId: job.job_id,
            paymentIntentId: options.paymentIntent.id,
            credits: pack.credits.toString(),
          },
        },
      ]
    : [];
}

async function processAutoTopupFailed(options: {
  database: Knex;
  paymentIntent: Stripe.PaymentIntent;
  events: GatewayEventEmitter;
  maxAttempts: number;
  retryBaseMs: number;
}): Promise<void> {
  const jobId = options.paymentIntent.metadata.auto_topup_job_id?.trim();
  if (!jobId || options.paymentIntent.metadata.source !== 'auto-topup') {
    return;
  }
  await recordAutoTopupFailure({
    database: options.database,
    jobId,
    error: options.paymentIntent.last_payment_error?.message ?? 'Stripe PaymentIntent failed',
    maxAttempts: options.maxAttempts,
    retryBaseMs: options.retryBaseMs,
    events: options.events,
  });
}

async function processEvent(options: {
  database: Knex;
  event: Stripe.Event;
  stripe: GatewayStripeClient;
  getTierConfig: TierConfigLoader;
  events: GatewayEventEmitter;
  maxAutoTopupAttempts: number;
  autoTopupRetryBaseMs: number;
}): Promise<GatewayEventInput[]> {
  switch (options.event.type) {
    case 'checkout.session.completed':
      return processCheckoutCompleted({
        database: options.database,
        session: options.event.data.object as Stripe.Checkout.Session,
        stripe: options.stripe,
        getTierConfig: options.getTierConfig,
      });
    case 'invoice.paid':
      await processInvoicePaid({
        database: options.database,
        invoice: options.event.data.object as Stripe.Invoice,
        getTierConfig: options.getTierConfig,
      });
      return [];
    case 'customer.subscription.updated':
      await updateSubscriptionStatus({
        database: options.database,
        subscription: options.event.data.object as Stripe.Subscription,
      });
      return [];
    case 'customer.subscription.deleted':
      await updateSubscriptionStatus({
        database: options.database,
        subscription: options.event.data.object as Stripe.Subscription,
        status: 'canceled',
      });
      return [];
    case 'invoice.payment_failed':
      await processInvoiceFailed({
        database: options.database,
        invoice: options.event.data.object as Stripe.Invoice,
        stripe: options.stripe,
      });
      return [];
    case 'payment_intent.succeeded':
      return processAutoTopupSucceeded({
        database: options.database,
        paymentIntent: options.event.data.object as Stripe.PaymentIntent,
        getTierConfig: options.getTierConfig,
      });
    case 'payment_intent.payment_failed':
      await processAutoTopupFailed({
        database: options.database,
        paymentIntent: options.event.data.object as Stripe.PaymentIntent,
        events: options.events,
        maxAttempts: options.maxAutoTopupAttempts,
        retryBaseMs: options.autoTopupRetryBaseMs,
      });
      return [];
    default:
      console.info(`[ai-gateway] Ignoring unsupported Stripe event ${options.event.type}`);
      return [];
  }
}

export interface StripeWebhookHandlerOptions {
  database: Knex;
  stripe: GatewayStripeClient;
  getTierConfig: TierConfigLoader;
  events: GatewayEventEmitter;
  getWebhookSecret: () => string;
  maxAutoTopupAttempts: number;
  autoTopupRetryBaseMs?: number;
}

export function createStripeWebhookHandler(options: StripeWebhookHandlerOptions): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    void (async () => {
      const secret = options.getWebhookSecret().trim();
      if (!secret) {
        throw new HttpError(503, 'stripe_not_configured', 'Stripe webhooks are not configured.');
      }
      const signature = request.get('stripe-signature');
      if (!signature) {
        throw new HttpError(400, 'invalid_stripe_signature', 'Stripe signature is required.');
      }
      if (!Buffer.isBuffer(request.body)) {
        throw new HttpError(400, 'invalid_stripe_payload', 'Stripe webhook body must be raw bytes.');
      }

      let event: Stripe.Event;
      try {
        event = options.stripe.constructWebhookEvent(request.body, signature, secret);
      } catch (error) {
        throw new HttpError(400, 'invalid_stripe_signature', 'Stripe signature is invalid.', {
          cause: error,
        });
      }
      const payloadHash = createHash('sha256').update(request.body).digest('hex');
      const outcome = await options.database.transaction(async (transaction) => {
        const inserted = (await transaction('stripe_webhook_events')
          .insert({
            event_id: event.id,
            type: event.type,
            processed_at: new Date(),
            payload_hash: payloadHash,
          })
          .onConflict('event_id')
          .ignore()
          .returning('event_id')) as Array<{ event_id: string }>;
        if (!inserted[0]) {
          return { duplicate: true, events: [] as GatewayEventInput[] };
        }
        const bufferedEvents: GatewayEventInput[] = [];
        const transactionEvents = await processEvent({
          database: transaction,
          event,
          stripe: options.stripe,
          getTierConfig: options.getTierConfig,
          events: { emit: (gatewayEvent) => bufferedEvents.push(gatewayEvent) },
          maxAutoTopupAttempts: options.maxAutoTopupAttempts,
          autoTopupRetryBaseMs:
            options.autoTopupRetryBaseMs ?? AUTO_TOPUP_RETRY_BASE_MS,
        });
        return {
          duplicate: false,
          events: [...bufferedEvents, ...transactionEvents],
        };
      });
      for (const gatewayEvent of outcome.events) {
        options.events.emit(gatewayEvent);
      }
      response.status(200).json({ received: true, duplicate: outcome.duplicate });
    })().catch(next);
  };
}
