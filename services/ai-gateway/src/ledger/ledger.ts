import { randomUUID } from 'node:crypto';

import type { Knex } from 'knex';

import {
  parseBigint,
  requireNonNegativeBigint,
  requirePositiveBigint,
  type BigintValue,
} from '../db/bigint.js';
import type { AiAccountRow, LedgerBucket, LedgerEntryType } from '../db/types.js';
import { planMonthlyRenewal, planUsageDebit, type BalanceMovement } from './math.js';

export interface UsageDebitInput {
  accountId: string;
  feature: string;
  model: string;
  provider: string;
  promptTokens: BigintValue;
  completionTokens: BigintValue;
  totalTokens: BigintValue;
  creditsCharged: BigintValue;
  requestId: string;
  durationMs: BigintValue;
  createdAt?: Date;
}

export interface PersistedLedgerMovement {
  entryId: string;
  entryType: LedgerEntryType;
  bucket: LedgerBucket;
  credits: bigint;
  balanceAfter: bigint;
}

export interface UsageDebitResult {
  usageId: string;
  includedBalance: bigint;
  topupBalance: bigint;
  totalBalance: bigint;
  ledgerMovements: PersistedLedgerMovement[];
}

export interface MonthlyRenewalInput {
  accountId: string;
  monthlyAllotment: BigintValue;
  cycleStartedAt?: Date;
  stripeRef?: string;
  note?: string;
}

export interface MonthlyRenewalResult {
  includedBalance: bigint;
  topupBalance: bigint;
  totalBalance: bigint;
  ledgerMovements: PersistedLedgerMovement[];
}

async function loadAccountForUpdate(
  transaction: Knex.Transaction,
  accountId: string,
): Promise<AiAccountRow> {
  const account = await transaction<AiAccountRow>('ai_accounts')
    .where({ account_id: accountId })
    .forUpdate()
    .first();

  if (!account) {
    throw new Error(`AI account ${accountId} does not exist`);
  }

  return account;
}

async function insertLedgerMovements(
  transaction: Knex.Transaction,
  accountId: string,
  movements: readonly BalanceMovement[],
  details: {
    usageId?: string;
    stripeRef?: string;
    note?: string;
    createdAt: Date;
  },
): Promise<PersistedLedgerMovement[]> {
  const persisted: PersistedLedgerMovement[] = [];

  for (const movement of movements) {
    const insertedRows = (await transaction('credit_ledger')
      .insert({
        account_id: accountId,
        entry_type: movement.entryType,
        bucket: movement.bucket,
        credits: movement.credits.toString(),
        balance_after: movement.balanceAfter.toString(),
        stripe_ref: details.stripeRef ?? null,
        usage_id: details.usageId ?? null,
        note: details.note ?? null,
        created_at: details.createdAt,
      })
      .returning('entry_id')) as Array<{ entry_id: string }>;

    const inserted = insertedRows[0];
    if (!inserted) {
      throw new Error('Ledger movement insert did not return an entry_id');
    }

    persisted.push({
      entryId: inserted.entry_id,
      entryType: movement.entryType,
      bucket: movement.bucket,
      credits: movement.credits,
      balanceAfter: movement.balanceAfter,
    });
  }

  return persisted;
}

function requireText(value: string, fieldName: string): string {
  if (!value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

export async function debitUsage(database: Knex, input: UsageDebitInput): Promise<UsageDebitResult> {
  const promptTokens = requireNonNegativeBigint(input.promptTokens, 'promptTokens');
  const completionTokens = requireNonNegativeBigint(input.completionTokens, 'completionTokens');
  const totalTokens = requireNonNegativeBigint(input.totalTokens, 'totalTokens');
  const creditsCharged = requirePositiveBigint(input.creditsCharged, 'creditsCharged');
  const durationMs = requireNonNegativeBigint(input.durationMs, 'durationMs');

  if (totalTokens !== promptTokens + completionTokens) {
    throw new Error('totalTokens must equal promptTokens plus completionTokens');
  }

  requireText(input.accountId, 'accountId');
  requireText(input.feature, 'feature');
  requireText(input.model, 'model');
  requireText(input.provider, 'provider');
  requireText(input.requestId, 'requestId');

  return database.transaction(async (transaction) => {
    const account = await loadAccountForUpdate(transaction, input.accountId);
    const includedBalance = parseBigint(account.included_balance, 'account.included_balance');
    const topupBalance = parseBigint(account.topup_balance, 'account.topup_balance');
    const plan = planUsageDebit(includedBalance, topupBalance, creditsCharged);
    const usageId = randomUUID();
    const createdAt = input.createdAt ?? new Date();

    await transaction('ai_usage_events').insert({
      usage_id: usageId,
      account_id: input.accountId,
      feature: input.feature,
      model: input.model,
      provider: input.provider,
      prompt_tokens: promptTokens.toString(),
      completion_tokens: completionTokens.toString(),
      total_tokens: totalTokens.toString(),
      credits_charged: creditsCharged.toString(),
      request_id: input.requestId,
      duration_ms: durationMs.toString(),
      created_at: createdAt,
    });

    const ledgerMovements = await insertLedgerMovements(
      transaction,
      input.accountId,
      plan.movements,
      {
        usageId,
        createdAt,
      },
    );

    const updatedCount = await transaction('ai_accounts')
      .where({ account_id: input.accountId })
      .update({
        included_balance: plan.includedBalance.toString(),
        topup_balance: plan.topupBalance.toString(),
        updated_at: createdAt,
      });

    if (updatedCount !== 1) {
      throw new Error(`Expected to update one AI account, updated ${updatedCount}`);
    }

    return {
      usageId,
      includedBalance: plan.includedBalance,
      topupBalance: plan.topupBalance,
      totalBalance: plan.includedBalance + plan.topupBalance,
      ledgerMovements,
    };
  });
}

export async function renewMonthlyCycle(
  database: Knex,
  input: MonthlyRenewalInput,
): Promise<MonthlyRenewalResult> {
  requireText(input.accountId, 'accountId');
  const monthlyAllotment = requirePositiveBigint(input.monthlyAllotment, 'monthlyAllotment');

  return database.transaction(async (transaction) => {
    const account = await loadAccountForUpdate(transaction, input.accountId);
    const includedBalance = parseBigint(account.included_balance, 'account.included_balance');
    const topupBalance = parseBigint(account.topup_balance, 'account.topup_balance');
    const plan = planMonthlyRenewal(includedBalance, topupBalance, monthlyAllotment);
    const cycleStartedAt = input.cycleStartedAt ?? new Date();

    const ledgerMovements = await insertLedgerMovements(
      transaction,
      input.accountId,
      plan.movements,
      {
        stripeRef: input.stripeRef,
        note: input.note,
        createdAt: cycleStartedAt,
      },
    );

    const updatedCount = await transaction('ai_accounts')
      .where({ account_id: input.accountId })
      .update({
        included_balance: plan.includedBalance.toString(),
        topup_balance: plan.topupBalance.toString(),
        cycle_started_at: cycleStartedAt,
        updated_at: cycleStartedAt,
      });

    if (updatedCount !== 1) {
      throw new Error(`Expected to update one AI account, updated ${updatedCount}`);
    }

    return {
      includedBalance: plan.includedBalance,
      topupBalance: plan.topupBalance,
      totalBalance: plan.includedBalance + plan.topupBalance,
      ledgerMovements,
    };
  });
}
