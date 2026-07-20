import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { findOrCreateAccount } from '../../accounts/accounts.js';
import { createDatabase } from '../../db/client.js';
import { debitUsage, renewMonthlyCycle } from '../../ledger/ledger.js';
import type { TierConfig } from '../../tier/tierConfig.js';

const testDatabaseUrl = process.env.AI_GATEWAY_TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const TEST_TIER_CONFIG: TierConfig = {
  monthlyIncludedCredits: 100n,
  gracePercentBasisPoints: 1_000n,
  topupPacks: [{ priceId: 'price_test', credits: 25n }],
  lowBalanceThreshold: 10n,
};
const getTestTierConfig = async (): Promise<TierConfig> => TEST_TIER_CONFIG;

interface AccountBalances {
  included_balance: string;
  topup_balance: string;
  subscription_status: string;
}

interface LedgerRow {
  entry_id: string;
  entry_type: string;
  bucket: string;
  credits: string;
  balance_after: string;
  usage_id: string | null;
}

async function setAccountState(
  database: Knex,
  accountId: string,
  includedBalance: bigint,
  topupBalance: bigint,
): Promise<void> {
  await database('ai_accounts').where({ account_id: accountId }).update({
    included_balance: includedBalance.toString(),
    topup_balance: topupBalance.toString(),
    subscription_status: 'active',
    updated_at: new Date(),
  });
}

function usageDebitInput(accountId: string, creditsCharged: bigint) {
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

describeWithDatabase('ledger persistence', () => {
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
    if (database) {
      await database.destroy();
    }
  });

  it('migrates the full service-owned schema with bigint credit and token columns', async () => {
    const expectedTables = [
      'ai_accounts',
      'credit_ledger',
      'ai_usage_events',
      'pricing_config',
      'consent_records',
      'stripe_webhook_events',
      'tier_config',
      'auto_topup_jobs',
    ];
    const tableRows = await database('information_schema.tables')
      .where({ table_schema: 'public' })
      .whereIn('table_name', expectedTables)
      .pluck<string>('table_name');

    expect(new Set(tableRows)).toEqual(new Set(expectedTables));

    const bigintColumns: Record<string, string[]> = {
      ai_accounts: [
        'included_balance',
        'topup_balance',
        'grace_limit_credits',
        'low_balance_threshold',
        'auto_topup_threshold_credits',
      ],
      credit_ledger: ['credits', 'balance_after'],
      ai_usage_events: [
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
        'credits_charged',
      ],
      pricing_config: [
        'credits_per_1k_input_tokens',
        'credits_per_1k_output_tokens',
      ],
      tier_config: ['monthly_included_credits', 'low_balance_threshold'],
    };

    for (const [tableName, columnNames] of Object.entries(bigintColumns)) {
      const rows = await database('information_schema.columns')
        .where({ table_schema: 'public', table_name: tableName })
        .whereIn('column_name', columnNames)
        .select<{ column_name: string; data_type: string }[]>(['column_name', 'data_type']);

      expect(rows).toHaveLength(columnNames.length);
      expect(rows.every((row) => row.data_type === 'bigint')).toBe(true);
    }
  });

  it('creates one lazy account per tenant and deployment with status none', async () => {
    const tenantId = randomUUID();
    const first = await findOrCreateAccount(
      database,
      { tenantId, deploymentType: 'hosted' },
      getTestTierConfig,
    );
    const second = await findOrCreateAccount(
      database,
      { tenantId, deploymentType: 'hosted' },
      getTestTierConfig,
    );

    expect(second.account_id).toBe(first.account_id);
    expect(first).toMatchObject({
      subscription_status: 'none',
      included_balance: '0',
      topup_balance: '0',
    });
    expect(await database('ai_accounts').count('* as count').first()).toMatchObject({ count: '1' });
  });

  it('locks the account and persists included-then-topup debit movements plus usage', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      getTestTierConfig,
    );
    await setAccountState(database, account.account_id, 100n, 50n);

    const result = await debitUsage(database, usageDebitInput(account.account_id, 120n));

    expect(result).toMatchObject({
      includedBalance: 0n,
      topupBalance: 30n,
      totalBalance: 30n,
    });
    expect(result.ledgerMovements).toEqual([
      expect.objectContaining({
        bucket: 'included',
        credits: -100n,
        balanceAfter: 50n,
      }),
      expect.objectContaining({
        bucket: 'topup',
        credits: -20n,
        balanceAfter: 30n,
      }),
    ]);

    const persistedAccount = await database<AccountBalances>('ai_accounts')
      .where({ account_id: account.account_id })
      .first();
    expect(persistedAccount).toMatchObject({ included_balance: '0', topup_balance: '30' });

    const usage = await database('ai_usage_events')
      .where({ usage_id: result.usageId })
      .first();
    expect(usage).toMatchObject({ credits_charged: '120', total_tokens: '2' });
  });

  it('carries an included deficit into renewal and does not change top-up credits', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      getTestTierConfig,
    );
    await setAccountState(database, account.account_id, -25n, 30n);

    const result = await renewMonthlyCycle(database, {
      accountId: account.account_id,
      monthlyAllotment: 100n,
      cycleStartedAt: new Date('2026-07-20T00:00:00.000Z'),
      stripeRef: 'in_test_cycle',
    });

    expect(result).toMatchObject({
      includedBalance: 75n,
      topupBalance: 30n,
      totalBalance: 105n,
    });
    expect(result.ledgerMovements).toEqual([
      expect.objectContaining({
        entryType: 'grant_included',
        credits: 100n,
        balanceAfter: 105n,
      }),
    ]);
  });

  it('maintains an exact balance_after chain across grants, expiry, and a split debit', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      getTestTierConfig,
    );

    await renewMonthlyCycle(database, {
      accountId: account.account_id,
      monthlyAllotment: 100n,
    });

    await database.transaction(async (transaction) => {
      await transaction('ai_accounts')
        .where({ account_id: account.account_id })
        .forUpdate()
        .update({ topup_balance: '50', updated_at: new Date() });
      await transaction('credit_ledger').insert({
        account_id: account.account_id,
        entry_type: 'grant_topup',
        bucket: 'topup',
        credits: '50',
        balance_after: '150',
        note: 'test top-up grant',
      });
    });

    await debitUsage(database, usageDebitInput(account.account_id, 120n));

    const ledgerRows = await database<LedgerRow>('credit_ledger')
      .where({ account_id: account.account_id })
      .orderBy('entry_id', 'asc');

    let runningBalance = 0n;
    for (const row of ledgerRows) {
      runningBalance += BigInt(row.credits);
      expect(BigInt(row.balance_after)).toBe(runningBalance);
    }

    expect(runningBalance).toBe(30n);
    expect(ledgerRows.map((row) => [row.entry_type, row.bucket, row.credits])).toEqual([
      ['grant_included', 'included', '100'],
      ['grant_topup', 'topup', '50'],
      ['usage_debit', 'included', '-100'],
      ['usage_debit', 'topup', '-20'],
    ]);
  });

  it('serializes parallel debits without lost updates', async () => {
    const account = await findOrCreateAccount(
      database,
      { tenantId: randomUUID(), deploymentType: 'hosted' },
      getTestTierConfig,
    );
    await setAccountState(database, account.account_id, 1_000n, 0n);

    await Promise.all(
      Array.from({ length: 16 }, () =>
        debitUsage(database, usageDebitInput(account.account_id, 7n)),
      ),
    );

    const persistedAccount = await database<AccountBalances>('ai_accounts')
      .where({ account_id: account.account_id })
      .first();
    expect(persistedAccount).toMatchObject({ included_balance: '888', topup_balance: '0' });

    const ledgerRows = await database<LedgerRow>('credit_ledger')
      .where({ account_id: account.account_id })
      .orderBy('entry_id', 'asc');
    expect(ledgerRows).toHaveLength(16);
    expect(ledgerRows.at(-1)?.balance_after).toBe('888');

    const usageCount = await database('ai_usage_events')
      .where({ account_id: account.account_id })
      .count('* as count')
      .first();
    expect(usageCount).toMatchObject({ count: '16' });
  });
});
