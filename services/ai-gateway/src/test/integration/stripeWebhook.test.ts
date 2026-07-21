import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import path from 'node:path';

import type { Knex } from 'knex';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { findOrCreateAccount } from '../../accounts/accounts.js';
import { createDatabase } from '../../db/client.js';
import type { GatewayEventEmitter, GatewayEventInput } from '../../events/events.js';
import { createApp } from '../../http/app.js';
import type {
  AutoTopupPaymentIntentInput,
  GatewayStripeClient,
} from '../../stripe/stripeClient.js';
import { loadTierConfig, type TierConfig } from '../../tier/tierConfig.js';

const testDatabaseUrl = process.env.AI_GATEWAY_TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const WEBHOOK_SECRET = 'whsec_ai_gateway_integration';
const PACK_PRICE_ID = 'price_ai_pack_test';

class TestStripeClient implements GatewayStripeClient {
  private readonly verifier = new Stripe('sk_test_gateway');
  readonly retrieveSubscription = vi.fn<(id: string) => Promise<Stripe.Subscription>>();
  readonly getCheckoutPriceId = vi.fn<(id: string) => Promise<string>>();
  readonly createAutoTopupPaymentIntent = vi.fn<
    (input: AutoTopupPaymentIntentInput) => Promise<Stripe.PaymentIntent>
  >();

  constructWebhookEvent(payload: Buffer, signature: string, secret: string): Stripe.Event {
    return this.verifier.webhooks.constructEvent(payload, signature, secret);
  }
}

class CapturingEvents implements GatewayEventEmitter {
  readonly emitted: GatewayEventInput[] = [];

  emit(event: GatewayEventInput): void {
    this.emitted.push(event);
  }
}

function testTier(): TierConfig {
  return {
    monthlyIncludedCredits: 100n,
    gracePercentBasisPoints: 1_000n,
    topupPacks: [{ priceId: PACK_PRICE_ID, credits: 25n }],
    lowBalanceThreshold: 10n,
  };
}

function subscription(
  id: string,
  status: Stripe.Subscription.Status,
  customer = 'cus_ai_test',
): Stripe.Subscription {
  return { id, object: 'subscription', status, customer } as Stripe.Subscription;
}

function stripeEvent(type: string, object: object, id = `evt_${randomUUID()}`): object {
  return {
    id,
    object: 'event',
    api_version: '2025-09-30.clover',
    created: Math.floor(Date.now() / 1_000),
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describeWithDatabase('Stripe webhook consumer', () => {
  let database: Knex;
  let server: Server;
  let baseUrl: string;
  let stripe: TestStripeClient;
  let events: CapturingEvents;

  const postEvent = async (event: object): Promise<Response> => {
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return fetch(`${baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
      },
      body: payload,
    });
  };

  beforeAll(async () => {
    database = createDatabase({ connectionString: testDatabaseUrl, poolMax: 12 });
    await database.migrate.latest({
      directory: path.resolve(process.cwd(), 'migrations'),
      extension: 'cjs',
      tableName: 'knex_migrations',
    });

    stripe = new TestStripeClient();
    events = new CapturingEvents();
    server = createApp({
      database,
      stripe,
      events,
      getTierConfig: () => loadTierConfig(database),
      stripeWebhookSecret: WEBHOOK_SECRET,
      autoTopupMaxAttempts: 2,
      autoTopupRetryBaseMs: 1,
    }).listen(0, '127.0.0.1');
    const port = await new Promise<number>((resolve, reject) => {
      server.once('listening', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Stripe webhook test server did not bind'));
          return;
        }
        resolve(address.port);
      });
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(async () => {
    stripe.retrieveSubscription.mockReset();
    stripe.getCheckoutPriceId.mockReset();
    stripe.createAutoTopupPaymentIntent.mockReset();
    events.emitted.length = 0;
    await database.raw(`
      TRUNCATE TABLE
        auto_topup_jobs,
        credit_ledger,
        ai_usage_events,
        consent_records,
        pricing_config,
        tier_config,
        stripe_webhook_events,
        ai_accounts
      RESTART IDENTITY CASCADE
    `);
    await database('tier_config').insert({
      tier_key: 'single',
      monthly_included_credits: '100',
      grace_percent_basis_points: 1_000,
      topup_packs: JSON.stringify([{ priceId: PACK_PRICE_ID, credits: '25' }]),
      low_balance_threshold: '10',
    });
  });

  afterAll(async () => {
    if (server) await close(server);
    if (database) await database.destroy();
  });

  it('binds an add-on checkout, initializes tier defaults, and skips exact replay', async () => {
    const tenantId = randomUUID();
    stripe.retrieveSubscription.mockResolvedValue(subscription('sub_ai_addon', 'active'));
    const event = stripeEvent(
      'checkout.session.completed',
      {
        id: 'cs_ai_addon',
        object: 'checkout.session',
        customer: 'cus_ai_addon',
        subscription: 'sub_ai_addon',
        payment_intent: null,
        metadata: {
          purpose: 'ai-addon',
          tenant_id: tenantId,
          deployment_type: 'hosted',
        },
      },
      'evt_ai_addon',
    );

    expect((await postEvent(event)).status).toBe(200);
    expect(await (await postEvent(event)).json()).toEqual({ received: true, duplicate: true });

    expect(await database('ai_accounts').where({ tenant_id: tenantId }).first()).toMatchObject({
      stripe_customer_id: 'cus_ai_addon',
      stripe_subscription_id: 'sub_ai_addon',
      subscription_status: 'active',
      grace_limit_credits: '10',
      low_balance_threshold: '10',
    });
    expect(await database('stripe_webhook_events').count('* as count').first()).toMatchObject({
      count: '1',
    });
    expect(stripe.retrieveSubscription).toHaveBeenCalledOnce();
  });

  it('grants a configured manual top-up once from checkout line items', async () => {
    const tenantId = randomUUID();
    stripe.getCheckoutPriceId.mockResolvedValue(PACK_PRICE_ID);
    const checkout = {
      id: 'cs_ai_topup',
      object: 'checkout.session',
      customer: 'cus_ai_topup',
      subscription: null,
      payment_intent: 'pi_manual_topup',
      metadata: {
        purpose: 'ai-topup',
        tenant_id: tenantId,
        deployment_type: 'appliance',
      },
    };

    expect(
      (await postEvent(stripeEvent('checkout.session.completed', checkout, 'evt_topup_one')))
        .status,
    ).toBe(200);
    expect(
      (await postEvent(stripeEvent('checkout.session.completed', checkout, 'evt_topup_two')))
        .status,
    ).toBe(200);

    const account = await database('ai_accounts').where({ tenant_id: tenantId }).first();
    expect(account).toMatchObject({
      stripe_customer_id: 'cus_ai_topup',
      topup_balance: '25',
    });
    expect(
      await database('credit_ledger')
        .where({ account_id: account.account_id, stripe_ref: 'pi_manual_topup' }),
    ).toHaveLength(1);
    expect(await database('credit_ledger').where({ account_id: account.account_id }).first())
      .toMatchObject({
        entry_type: 'grant_topup',
        credits: '25',
        stripe_ref: 'pi_manual_topup',
        balance_after: '25',
      });
  });

  it('renews an invoice only once even when different events repeat its invoice id', async () => {
    const tenantId = randomUUID();
    const account = await findOrCreateAccount(
      database,
      { tenantId, deploymentType: 'hosted' },
      async () => testTier(),
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      stripe_subscription_id: 'sub_invoice_test',
      included_balance: '20',
      topup_balance: '5',
      subscription_status: 'active',
    });
    const invoice = {
      id: 'in_ai_cycle',
      object: 'invoice',
      period_start: 1_753_056_000,
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: 'sub_invoice_test' },
      },
    };

    expect((await postEvent(stripeEvent('invoice.paid', invoice, 'evt_invoice_one'))).status)
      .toBe(200);
    expect((await postEvent(stripeEvent('invoice.paid', invoice, 'evt_invoice_two'))).status)
      .toBe(200);

    expect(await database('ai_accounts').where({ account_id: account.account_id }).first())
      .toMatchObject({ included_balance: '100', topup_balance: '5' });
    expect(
      await database('credit_ledger')
        .where({ entry_type: 'grant_included', stripe_ref: 'in_ai_cycle' })
        .count('* as count')
        .first(),
    ).toMatchObject({ count: '1' });
  });

  it('grants an automatic top-up on PaymentIntent success and completes its job', async () => {
    const tenantId = randomUUID();
    const account = await findOrCreateAccount(
      database,
      { tenantId, deploymentType: 'hosted' },
      async () => testTier(),
    );
    const [job] = await database('auto_topup_jobs')
      .insert({
        account_id: account.account_id,
        pack_price_id: PACK_PRICE_ID,
        status: 'awaiting_webhook',
        attempt_count: 1,
        payment_intent_id: 'pi_auto_topup',
      })
      .returning('job_id');
    const event = stripeEvent('payment_intent.succeeded', {
      id: 'pi_auto_topup',
      object: 'payment_intent',
      status: 'succeeded',
      metadata: {
        purpose: 'ai-topup',
        source: 'auto-topup',
        auto_topup_job_id: job.job_id,
      },
    });

    expect((await postEvent(event)).status).toBe(200);
    expect(await database('auto_topup_jobs').where({ job_id: job.job_id }).first())
      .toMatchObject({ status: 'succeeded', payment_intent_id: 'pi_auto_topup' });
    expect(await database('ai_accounts').where({ account_id: account.account_id }).first())
      .toMatchObject({ topup_balance: '25', auto_topup_failure_count: 0 });
    expect(events.emitted.map((item) => item.type)).toEqual(['auto_topup_succeeded']);
  });

  it('retries a signed automatic PaymentIntent failure and records the event once', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      async () => testTier(),
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      auto_topup_enabled: true,
    });
    const [job] = await database('auto_topup_jobs')
      .insert({
        account_id: account.account_id,
        pack_price_id: PACK_PRICE_ID,
        status: 'awaiting_webhook',
        attempt_count: 1,
        payment_intent_id: 'pi_auto_failed',
      })
      .returning('job_id');
    const event = stripeEvent(
      'payment_intent.payment_failed',
      {
        id: 'pi_auto_failed',
        object: 'payment_intent',
        status: 'requires_payment_method',
        last_payment_error: { message: 'card declined' },
        metadata: {
          purpose: 'ai-topup',
          source: 'auto-topup',
          auto_topup_job_id: job.job_id,
        },
      },
      'evt_auto_failed',
    );

    expect((await postEvent(event)).status).toBe(200);
    expect(await (await postEvent(event)).json()).toEqual({ received: true, duplicate: true });
    expect(await database('auto_topup_jobs').where({ job_id: job.job_id }).first())
      .toMatchObject({ status: 'pending', attempt_count: 1, last_error: 'card declined' });
    expect(await database('ai_accounts').where({ account_id: account.account_id }).first())
      .toMatchObject({ auto_topup_enabled: true, auto_topup_failure_count: 1 });
    expect(events.emitted.map((item) => item.type)).toEqual(['auto_topup_failed']);
  });

  it('updates subscription states for update, invoice failure, and deletion fixtures', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      async () => testTier(),
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      stripe_subscription_id: 'sub_status_test',
      subscription_status: 'active',
    });

    await postEvent(
      stripeEvent(
        'customer.subscription.updated',
        subscription('sub_status_test', 'past_due'),
      ),
    );
    expect(await database('ai_accounts').where({ account_id: account.account_id }).first())
      .toMatchObject({ subscription_status: 'past_due' });

    stripe.retrieveSubscription.mockResolvedValue(subscription('sub_status_test', 'unpaid'));
    await postEvent(
      stripeEvent('invoice.payment_failed', {
        id: 'in_failed',
        object: 'invoice',
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: 'sub_status_test' },
        },
      }),
    );
    expect(await database('ai_accounts').where({ account_id: account.account_id }).first())
      .toMatchObject({ subscription_status: 'unpaid' });

    await postEvent(
      stripeEvent(
        'customer.subscription.deleted',
        subscription('sub_status_test', 'canceled'),
      ),
    );
    expect(await database('ai_accounts').where({ account_id: account.account_id }).first())
      .toMatchObject({ subscription_status: 'canceled' });
  });

  it('records and ignores a signed unknown event without mutating accounts', async () => {
    const response = await postEvent(
      stripeEvent('charge.refunded', { id: 'ch_ignored', object: 'charge' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
    expect(await database('ai_accounts').count('* as count').first()).toMatchObject({ count: '0' });
    expect(await database('stripe_webhook_events').count('* as count').first()).toMatchObject({
      count: '1',
    });
  });

  it('rejects an invalid webhook signature without recording the event', async () => {
    const response = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'invalid' },
      body: JSON.stringify(stripeEvent('charge.refunded', {})),
    });
    expect(response.status).toBe(400);
    expect(await database('stripe_webhook_events').count('* as count').first()).toMatchObject({
      count: '0',
    });
  });
});
