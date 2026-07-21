import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Knex } from 'knex';
import type Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { findOrCreateAccount } from '../../accounts/accounts.js';
import { createPostDebitHandler, emitDebitTransitions } from '../../autoTopup/postDebit.js';
import { AutoTopupWorker } from '../../autoTopup/worker.js';
import { createDatabase } from '../../db/client.js';
import type { GatewayEventEmitter, GatewayEventInput } from '../../events/events.js';
import { debitUsage } from '../../ledger/ledger.js';
import type { GatewayStripeClient } from '../../stripe/stripeClient.js';
import type { TierConfig } from '../../tier/tierConfig.js';

const testDatabaseUrl = process.env.AI_GATEWAY_TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const PACK_PRICE_ID = 'price_auto_pack';
const TEST_TIER: TierConfig = {
  monthlyIncludedCredits: 100n,
  gracePercentBasisPoints: 1_000n,
  topupPacks: [{ priceId: PACK_PRICE_ID, credits: 25n }],
  lowBalanceThreshold: 10n,
};
const getTierConfig = async (): Promise<TierConfig> => TEST_TIER;

class CapturingEvents implements GatewayEventEmitter {
  readonly emitted: GatewayEventInput[] = [];

  emit(event: GatewayEventInput): void {
    this.emitted.push(event);
  }
}

function unusedStripeMethods(
  createAutoTopupPaymentIntent: GatewayStripeClient['createAutoTopupPaymentIntent'],
): GatewayStripeClient {
  return {
    constructWebhookEvent: () => {
      throw new Error('not used');
    },
    retrieveSubscription: async () => {
      throw new Error('not used');
    },
    getCheckoutPriceId: async () => {
      throw new Error('not used');
    },
    createAutoTopupPaymentIntent,
  };
}

function usageInput(accountId: string, creditsCharged: bigint) {
  return {
    accountId,
    feature: 'chat',
    model: 'test-model',
    provider: 'test-provider',
    promptTokens: 1n,
    completionTokens: 1n,
    totalTokens: 2n,
    creditsCharged,
    requestId: randomUUID(),
    durationMs: 1n,
  };
}

describeWithDatabase('auto top-up and debit events', () => {
  let database: Knex;

  beforeAll(async () => {
    database = createDatabase({ connectionString: testDatabaseUrl, poolMax: 12 });
    await database.migrate.latest({
      directory: path.resolve(process.cwd(), 'migrations'),
      extension: 'cjs',
      tableName: 'knex_migrations',
    });
  });

  beforeEach(async () => {
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
  });

  afterAll(async () => {
    if (database) await database.destroy();
  });

  it('creates only one active job when repeated after-debit hooks cross the threshold', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      getTierConfig,
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      subscription_status: 'active',
      included_balance: '20',
      auto_topup_enabled: true,
      auto_topup_threshold_credits: '18',
      auto_topup_pack_price_id: PACK_PRICE_ID,
    });
    const result = await debitUsage(database, usageInput(account.account_id, 5n));
    const handler = createPostDebitHandler({
      database,
      getTierConfig,
      events: new CapturingEvents(),
    });

    await Promise.all([handler(result), handler(result), handler(result)]);

    expect(await database('auto_topup_jobs').where({ account_id: account.account_id }))
      .toHaveLength(1);
    expect(await database('auto_topup_jobs').where({ account_id: account.account_id }).first())
      .toMatchObject({ status: 'pending', pack_price_id: PACK_PRICE_ID, attempt_count: 0 });
  });

  it('claims a pending job and initiates one confirmed off-session PaymentIntent', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'appliance' },
      getTierConfig,
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      stripe_customer_id: 'cus_auto_test',
      auto_topup_enabled: true,
      auto_topup_threshold_credits: '20',
      auto_topup_pack_price_id: PACK_PRICE_ID,
    });
    const [job] = await database('auto_topup_jobs')
      .insert({
        account_id: account.account_id,
        pack_price_id: PACK_PRICE_ID,
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: new Date('2026-07-20T00:00:00.000Z'),
      })
      .returning('job_id');
    const createIntent = vi
      .fn<GatewayStripeClient['createAutoTopupPaymentIntent']>()
      .mockResolvedValue({ id: 'pi_worker_test', status: 'succeeded' } as Stripe.PaymentIntent);
    const worker = new AutoTopupWorker({
      database,
      stripe: unusedStripeMethods(createIntent),
      getTierConfig,
      events: new CapturingEvents(),
      now: () => new Date('2026-07-20T01:00:00.000Z'),
    });

    expect(await worker.runOnce()).toBe(true);

    expect(createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: job.job_id,
        attempt: 1,
        customerId: 'cus_auto_test',
        priceId: PACK_PRICE_ID,
        accountId: account.account_id,
      }),
    );
    expect(await database('auto_topup_jobs').where({ job_id: job.job_id }).first())
      .toMatchObject({
        status: 'awaiting_webhook',
        attempt_count: 1,
        payment_intent_id: 'pi_worker_test',
      });
    expect(await database('credit_ledger').where({ account_id: account.account_id }))
      .toHaveLength(0);
  });

  it('retries with backoff and disables auto top-up after the configured maximum', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      getTierConfig,
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      stripe_customer_id: 'cus_failure_test',
      auto_topup_enabled: true,
      auto_topup_threshold_credits: '20',
      auto_topup_pack_price_id: PACK_PRICE_ID,
    });
    const [job] = await database('auto_topup_jobs')
      .insert({
        account_id: account.account_id,
        pack_price_id: PACK_PRICE_ID,
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: new Date('2026-07-20T00:00:00.000Z'),
      })
      .returning('job_id');
    const createIntent = vi
      .fn<GatewayStripeClient['createAutoTopupPaymentIntent']>()
      .mockRejectedValue(new Error('card declined'));
    const events = new CapturingEvents();
    let now = new Date('2026-07-20T01:00:00.000Z');
    const worker = new AutoTopupWorker({
      database,
      stripe: unusedStripeMethods(createIntent),
      getTierConfig,
      events,
      maxAttempts: 2,
      retryBaseMs: 1,
      now: () => now,
    });

    await worker.runOnce();
    expect(await database('auto_topup_jobs').where({ job_id: job.job_id }).first())
      .toMatchObject({ status: 'pending', attempt_count: 1 });
    now = new Date(now.getTime() + 2);
    await worker.runOnce();

    expect(createIntent).toHaveBeenCalledTimes(2);
    expect(await database('auto_topup_jobs').where({ job_id: job.job_id }).first())
      .toMatchObject({ status: 'failed', attempt_count: 2, last_error: 'card declined' });
    expect(await database('ai_accounts').where({ account_id: account.account_id }).first())
      .toMatchObject({ auto_topup_enabled: false, auto_topup_failure_count: 2 });
    expect(events.emitted.map((event) => event.type)).toEqual([
      'auto_topup_failed',
      'auto_topup_failed',
      'auto_topup_disabled',
    ]);
  });

  it('emits grace-entry and hard-stop only when each boundary is crossed', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      getTierConfig,
    );
    await database('ai_accounts').where({ account_id: account.account_id }).update({
      subscription_status: 'active',
      included_balance: '5',
      topup_balance: '0',
      grace_limit_credits: '10',
      low_balance_threshold: '2',
    });
    const events = new CapturingEvents();

    const enteredGrace = await debitUsage(database, usageInput(account.account_id, 6n));
    emitDebitTransitions(enteredGrace, events);
    const hardStop = await debitUsage(database, usageInput(account.account_id, 10n));
    emitDebitTransitions(hardStop, events);

    expect(events.emitted.map((event) => event.type)).toEqual([
      'low_balance_crossed',
      'entered_grace',
      'hard_stop',
    ]);
  });
});
