import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import type { Knex } from 'knex';

import { parseBigint, requireNonNegativeBigint, type BigintValue } from '../db/bigint.js';
import type {
  AiAccountRow,
  AiUsageEventRow,
  ConsentRecordRow,
} from '../db/types.js';

export type ConsentStatus = 'granted' | 'revoked' | 'missing';

export type AiSubscriptionStatus =
  | 'none'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

export interface AiAccountSummary {
  subscriptionStatus: AiSubscriptionStatus;
  includedBalanceCredits: number;
  topupBalanceCredits: number;
  graceLimitCredits: number;
  totalBalanceCredits: number;
  lowBalance: boolean;
  cycleStartedAt: string | null;
  autoTopup: {
    enabled: boolean;
    thresholdCredits: number | null;
    packPriceId: string | null;
  };
  consentStatus: ConsentStatus;
}

export interface AiUsageEvent {
  usageId: string;
  feature: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsCharged: number;
  createdAt: string;
}

export interface AiUsagePage {
  events: AiUsageEvent[];
  nextCursor: string | null;
}

export interface UsageQuery {
  from?: Date;
  to?: Date;
  feature?: string;
  cursor?: string;
  limit: number;
}

export interface AutoTopupUpdate {
  enabled: boolean;
  thresholdCredits?: BigintValue;
  packPriceId?: string;
}

interface UsageCursor {
  createdAt: string;
  usageId: string;
}

const SUBSCRIPTION_STATUSES = new Set<AiSubscriptionStatus>([
  'none',
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
]);

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toContractNumber(value: string | bigint, fieldName: string): number {
  const parsed = parseBigint(value, fieldName);
  const numberValue = Number(parsed);
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error(`${fieldName} exceeds the frozen API contract's safe integer range`);
  }
  return numberValue;
}

function normalizeSubscriptionStatus(status: string): AiSubscriptionStatus {
  return SUBSCRIPTION_STATUSES.has(status as AiSubscriptionStatus)
    ? (status as AiSubscriptionStatus)
    : 'none';
}

function encodeCursor(row: AiUsageEventRow): string {
  const cursor: UsageCursor = {
    createdAt: asDate(row.created_at).toISOString(),
    usageId: row.usage_id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): UsageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('createdAt' in parsed) ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      !('usageId' in parsed) ||
      typeof parsed.usageId !== 'string' ||
      !parsed.usageId
    ) {
      throw new Error('invalid cursor payload');
    }
    return { createdAt: parsed.createdAt, usageId: parsed.usageId };
  } catch {
    throw new Error('cursor is invalid');
  }
}

export async function loadAccount(database: Knex, accountId: string): Promise<AiAccountRow> {
  const account = await database<AiAccountRow>('ai_accounts')
    .where({ account_id: accountId })
    .first();
  if (!account) {
    throw new Error(`AI account ${accountId} does not exist`);
  }
  return account;
}

export async function getConsentStatus(
  database: Knex,
  account: AiAccountRow,
): Promise<ConsentStatus> {
  if (account.deployment_type === 'hosted') {
    return 'granted';
  }

  const latest = await database<ConsentRecordRow>('consent_records')
    .where({ account_id: account.account_id })
    .orderBy('granted_at', 'desc')
    .orderBy('consent_id', 'desc')
    .first();
  if (!latest) {
    return 'missing';
  }
  return latest.revoked_at === null ? 'granted' : 'revoked';
}

export async function hasActiveConsent(database: Knex, accountId: string): Promise<boolean> {
  const active = await database<ConsentRecordRow>('consent_records')
    .where({ account_id: accountId })
    .whereNull('revoked_at')
    .first('consent_id');
  return active !== undefined;
}

export async function buildAccountSummary(
  database: Knex,
  account: AiAccountRow,
): Promise<AiAccountSummary> {
  const includedBalance = parseBigint(account.included_balance, 'included_balance');
  const topupBalance = parseBigint(account.topup_balance, 'topup_balance');
  const totalBalance = includedBalance + topupBalance;
  const lowBalanceThreshold = parseBigint(
    account.low_balance_threshold,
    'low_balance_threshold',
  );

  return {
    subscriptionStatus: normalizeSubscriptionStatus(account.subscription_status),
    includedBalanceCredits: toContractNumber(includedBalance, 'included_balance'),
    topupBalanceCredits: toContractNumber(topupBalance, 'topup_balance'),
    graceLimitCredits: toContractNumber(account.grace_limit_credits, 'grace_limit_credits'),
    totalBalanceCredits: toContractNumber(totalBalance, 'total_balance'),
    lowBalance: totalBalance <= lowBalanceThreshold,
    cycleStartedAt: account.cycle_started_at
      ? asDate(account.cycle_started_at).toISOString()
      : null,
    autoTopup: {
      enabled: account.auto_topup_enabled,
      thresholdCredits:
        account.auto_topup_threshold_credits === null
          ? null
          : toContractNumber(
              account.auto_topup_threshold_credits,
              'auto_topup_threshold_credits',
            ),
      packPriceId: account.auto_topup_pack_price_id,
    },
    consentStatus: await getConsentStatus(database, account),
  };
}

export async function listUsageEvents(
  database: Knex,
  accountId: string,
  query: UsageQuery,
): Promise<AiUsagePage> {
  const builder = database<AiUsageEventRow>('ai_usage_events').where({ account_id: accountId });
  if (query.from) {
    builder.andWhere('created_at', '>=', query.from);
  }
  if (query.to) {
    builder.andWhere('created_at', '<=', query.to);
  }
  if (query.feature) {
    builder.andWhere('feature', query.feature);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    const cursorDate = new Date(cursor.createdAt);
    builder.andWhere((nested) => {
      nested
        .where('created_at', '<', cursorDate)
        .orWhere((sameTimestamp) => {
          sameTimestamp
            .where('created_at', '=', cursorDate)
            .andWhere('usage_id', '<', cursor.usageId);
        });
    });
  }

  const rows = await builder
    .orderBy('created_at', 'desc')
    .orderBy('usage_id', 'desc')
    .limit(query.limit + 1);
  const hasNextPage = rows.length > query.limit;
  const pageRows = hasNextPage ? rows.slice(0, query.limit) : rows;
  const lastRow = pageRows.at(-1);

  return {
    events: pageRows.map((row) => ({
      usageId: row.usage_id,
      feature: row.feature,
      model: row.model,
      provider: row.provider,
      promptTokens: toContractNumber(row.prompt_tokens, 'prompt_tokens'),
      completionTokens: toContractNumber(row.completion_tokens, 'completion_tokens'),
      totalTokens: toContractNumber(row.total_tokens, 'total_tokens'),
      creditsCharged: toContractNumber(row.credits_charged, 'credits_charged'),
      createdAt: asDate(row.created_at).toISOString(),
    })),
    nextCursor: hasNextPage && lastRow ? encodeCursor(lastRow) : null,
  };
}

export async function updateAutoTopup(
  database: Knex,
  accountId: string,
  update: AutoTopupUpdate,
): Promise<AiAccountRow> {
  return database.transaction(async (transaction) => {
    const account = await transaction<AiAccountRow>('ai_accounts')
      .where({ account_id: accountId })
      .forUpdate()
      .first();
    if (!account) {
      throw new Error(`AI account ${accountId} does not exist`);
    }

    const threshold =
      update.thresholdCredits === undefined
        ? account.auto_topup_threshold_credits
        : requireNonNegativeBigint(
            update.thresholdCredits,
            'thresholdCredits',
          ).toString();
    const packPriceId =
      update.packPriceId === undefined ? account.auto_topup_pack_price_id : update.packPriceId.trim();

    if (update.packPriceId !== undefined && !packPriceId) {
      throw new Error('packPriceId must not be empty');
    }
    if (update.enabled && (threshold === null || packPriceId === null)) {
      throw new Error('Enabling auto-topup requires thresholdCredits and packPriceId');
    }

    const rows = (await transaction('ai_accounts')
      .where({ account_id: accountId })
      .update({
        auto_topup_enabled: update.enabled,
        auto_topup_threshold_credits: threshold,
        auto_topup_pack_price_id: packPriceId,
        updated_at: new Date(),
      })
      .returning('*')) as AiAccountRow[];
    const updated = rows[0];
    if (!updated) {
      throw new Error('Auto-topup settings update did not return the account');
    }
    return updated;
  });
}

export async function grantConsent(
  database: Knex,
  accountId: string,
  grantedBy: string,
  termsVersion: string,
): Promise<void> {
  if (!grantedBy.trim() || !termsVersion.trim()) {
    throw new Error('grantedBy and termsVersion are required');
  }

  await database.transaction(async (transaction) => {
    const now = new Date();
    await transaction('consent_records')
      .where({ account_id: accountId })
      .whereNull('revoked_at')
      .update({ revoked_at: now, revoked_by: grantedBy.trim() });
    await transaction('consent_records').insert({
      consent_id: randomUUID(),
      account_id: accountId,
      granted_by: grantedBy.trim(),
      terms_version: termsVersion.trim(),
      granted_at: now,
      revoked_at: null,
      revoked_by: null,
    });
  });
}

export async function revokeConsent(
  database: Knex,
  accountId: string,
  revokedBy: string,
): Promise<void> {
  await database('consent_records')
    .where({ account_id: accountId })
    .whereNull('revoked_at')
    .update({
      revoked_at: new Date(),
      revoked_by: revokedBy,
    });
}
