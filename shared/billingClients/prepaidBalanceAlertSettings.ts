/**
 * Shared (horizontal) persistence + validation for the per-client prepaid
 * balance alert policy (task 29.8.20). This module has no server-only
 * dependencies so both the billing package actions and the clients package
 * UI actions can delegate to it without feature-to-feature imports.
 */

import type { Knex } from 'knex';
import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';

export const PREPAID_BALANCE_ALERT_FLAG = 'release-v1.5-feature';

export const PREPAID_REPLENISHMENT_TIERS = ['notify', 'draft', 'auto_issue'] as const;
export type PrepaidReplenishmentTier = typeof PREPAID_REPLENISHMENT_TIERS[number];

export const prepaidBalanceAlertSettingsInputSchema = z
  .object({
    clientId: z.string().min(1),
    prepaidCreditAlertThreshold: z.number().int().positive().nullable(),
    prepaidCreditAlertCurrencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Currency code must be three uppercase letters')
      .nullable(),
    bucketUsageAlertPercent: z.number().int().min(1).max(100).nullable(),
    notifyClientOnPrepaidAlert: z.boolean(),
    prepaidReplenishmentTier: z.enum(PREPAID_REPLENISHMENT_TIERS).default('draft'),
    /** Minor units for credit replenishment. */
    prepaidCreditReplenishmentAmount: z.number().int().positive().nullable().default(null),
    /** Minutes for bucket/hour replenishment. */
    prepaidBucketReplenishmentMinutes: z.number().int().positive().nullable().default(null),
    prepaidReplenishmentHorizonDays: z.number().int().min(0).max(3650).default(30),
  })
  // The credit amount and currency are either both present or both null; a
  // mismatched pair must be rejected by validation, not the DB constraint.
  .refine(
    (value) =>
      (value.prepaidCreditAlertThreshold === null) ===
      (value.prepaidCreditAlertCurrencyCode === null),
    {
      message: 'Credit amount and currency must be both set or both unset',
      path: ['prepaidCreditAlertCurrencyCode'],
    }
  );

export type PrepaidBalanceAlertSettingsInput = z.infer<typeof prepaidBalanceAlertSettingsInputSchema>;

export interface PrepaidBalanceAlertSettings {
  prepaidCreditAlertThreshold: number | null;
  prepaidCreditAlertCurrencyCode: string | null;
  bucketUsageAlertPercent: number | null;
  notifyClientOnPrepaidAlert: boolean;
  prepaidReplenishmentTier: PrepaidReplenishmentTier;
  prepaidCreditReplenishmentAmount: number | null;
  prepaidBucketReplenishmentMinutes: number | null;
  prepaidReplenishmentHorizonDays: number;
}

/** Read result: the persisted policy plus the client default currency when no policy exists. */
export interface PrepaidBalanceAlertSettingsWithDefault extends PrepaidBalanceAlertSettings {
  defaultCurrencyCode?: string;
}

export interface PrepaidReplenishmentContractOverride {
  clientContractId: string;
  contractId: string;
  contractName: string;
  prepaidReplenishmentTier: PrepaidReplenishmentTier | null;
  prepaidCreditReplenishmentAmount: number | null;
  prepaidBucketReplenishmentMinutes: number | null;
  prepaidReplenishmentHorizonDays: number | null;
}

export async function getPrepaidBalanceAlertSettingsDb(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<PrepaidBalanceAlertSettingsWithDefault | null> {
  const db = tenantDb(conn, tenant);
  const [settings, client] = await Promise.all([
    db.table('client_billing_settings').where({ client_id: clientId }).first(),
    db.table('clients').where({ client_id: clientId }).first('default_currency_code'),
  ]);

  // A missing tenant-scoped client is not equivalent to a real client with no
  // policy row. Callers use null to reject nonexistent and cross-tenant IDs.
  if (!client) {
    return null;
  }

  const result: PrepaidBalanceAlertSettingsWithDefault = {
    prepaidCreditAlertThreshold:
      settings?.prepaid_credit_alert_threshold != null
        ? Number(settings.prepaid_credit_alert_threshold)
        : null,
    prepaidCreditAlertCurrencyCode: settings?.prepaid_credit_alert_currency_code ?? null,
    bucketUsageAlertPercent:
      settings?.bucket_usage_alert_percent != null
        ? Number(settings.bucket_usage_alert_percent)
        : null,
    notifyClientOnPrepaidAlert: Boolean(settings?.notify_client_on_prepaid_alert),
    prepaidReplenishmentTier: PREPAID_REPLENISHMENT_TIERS.includes(settings?.prepaid_replenishment_tier)
      ? settings.prepaid_replenishment_tier
      : 'draft',
    prepaidCreditReplenishmentAmount:
      settings?.prepaid_credit_replenishment_amount != null ? Number(settings.prepaid_credit_replenishment_amount) : null,
    prepaidBucketReplenishmentMinutes:
      settings?.prepaid_bucket_replenishment_minutes != null ? Number(settings.prepaid_bucket_replenishment_minutes) : null,
    prepaidReplenishmentHorizonDays:
      settings?.prepaid_replenishment_horizon_days != null
        ? Number(settings.prepaid_replenishment_horizon_days)
        : 30,
  };
  if (client?.default_currency_code) {
    result.defaultCurrencyCode = client.default_currency_code;
  }
  return result;
}

/**
 * Persist only the prepaid-alert policy and replenishment columns. This deliberately does
 * not route through the broad null-delete behavior of updateClientBillingSettings:
 * unrelated billing settings are never touched. Disabling both alert types
 * forces client opt-in off.
 */
export async function updatePrepaidBalanceAlertSettingsDb(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: PrepaidBalanceAlertSettingsInput
): Promise<void> {
  const parsed = prepaidBalanceAlertSettingsInputSchema.parse(input);
  const {
    clientId,
    prepaidCreditAlertThreshold,
    prepaidCreditAlertCurrencyCode,
    bucketUsageAlertPercent,
    prepaidReplenishmentTier,
    prepaidCreditReplenishmentAmount,
    prepaidBucketReplenishmentMinutes,
    prepaidReplenishmentHorizonDays,
  } = parsed;
  const bothDisabled =
    prepaidCreditAlertThreshold === null &&
    prepaidCreditAlertCurrencyCode === null &&
    bucketUsageAlertPercent === null;
  const notifyClientOnPrepaidAlert = bothDisabled ? false : parsed.notifyClientOnPrepaidAlert;
  const effectiveReplenishmentTier = bothDisabled ? 'notify' : prepaidReplenishmentTier;
  const effectiveCreditReplenishmentAmount = bothDisabled ? null : prepaidCreditReplenishmentAmount;
  const effectiveBucketReplenishmentMinutes = bothDisabled ? null : prepaidBucketReplenishmentMinutes;

  const run = async (trx: Knex.Transaction): Promise<void> => {
    const db = tenantDb(trx, tenant);
    const client = await db.table('clients').where({ client_id: clientId }).first('client_id');
    if (!client) {
      throw new Error('Client not found');
    }

    await db.table('client_billing_settings')
      .insert({
        tenant,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        prepaid_credit_alert_threshold: prepaidCreditAlertThreshold,
        prepaid_credit_alert_currency_code: prepaidCreditAlertCurrencyCode,
        bucket_usage_alert_percent: bucketUsageAlertPercent,
        notify_client_on_prepaid_alert: notifyClientOnPrepaidAlert,
        prepaid_replenishment_tier: effectiveReplenishmentTier,
        prepaid_credit_replenishment_amount: effectiveCreditReplenishmentAmount,
        prepaid_bucket_replenishment_minutes: effectiveBucketReplenishmentMinutes,
        prepaid_replenishment_horizon_days: prepaidReplenishmentHorizonDays,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        prepaid_credit_alert_threshold: prepaidCreditAlertThreshold,
        prepaid_credit_alert_currency_code: prepaidCreditAlertCurrencyCode,
        bucket_usage_alert_percent: bucketUsageAlertPercent,
        notify_client_on_prepaid_alert: notifyClientOnPrepaidAlert,
        prepaid_replenishment_tier: effectiveReplenishmentTier,
        prepaid_credit_replenishment_amount: effectiveCreditReplenishmentAmount,
        prepaid_bucket_replenishment_minutes: effectiveBucketReplenishmentMinutes,
        prepaid_replenishment_horizon_days: prepaidReplenishmentHorizonDays,
        updated_at: trx.fn.now(),
      });
  };

  if (typeof (conn as Knex.Transaction).commit === 'function') {
    await run(conn as Knex.Transaction);
    return;
  }
  await (conn as Knex).transaction((trx) => run(trx));
}

export async function getPrepaidReplenishmentContractOverridesDb(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<PrepaidReplenishmentContractOverride[]> {
  const db = tenantDb(conn, tenant);
  const query = db.table('client_contracts as cc')
    .select(
      'cc.client_contract_id',
      'cc.contract_id',
      'c.contract_name',
      'cc.prepaid_replenishment_tier',
      'cc.prepaid_credit_replenishment_amount',
      'cc.prepaid_bucket_replenishment_minutes',
      'cc.prepaid_replenishment_horizon_days',
    )
    .where({ 'cc.client_id': clientId });
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  return (await query.orderBy('c.contract_name', 'asc')).map((row) => ({
    clientContractId: row.client_contract_id,
    contractId: row.contract_id,
    contractName: row.contract_name,
    prepaidReplenishmentTier: PREPAID_REPLENISHMENT_TIERS.includes(row.prepaid_replenishment_tier)
      ? row.prepaid_replenishment_tier
      : null,
    prepaidCreditReplenishmentAmount: row.prepaid_credit_replenishment_amount == null
      ? null : Number(row.prepaid_credit_replenishment_amount),
    prepaidBucketReplenishmentMinutes: row.prepaid_bucket_replenishment_minutes == null
      ? null : Number(row.prepaid_bucket_replenishment_minutes),
    prepaidReplenishmentHorizonDays: row.prepaid_replenishment_horizon_days == null
      ? null : Number(row.prepaid_replenishment_horizon_days),
  }));
}

export async function updatePrepaidReplenishmentContractOverrideDb(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: {
    clientId: string;
    clientContractId: string;
    prepaidReplenishmentTier: PrepaidReplenishmentTier | null;
    prepaidCreditReplenishmentAmount: number | null;
    prepaidBucketReplenishmentMinutes: number | null;
    prepaidReplenishmentHorizonDays: number | null;
  },
): Promise<void> {
  const tier = input.prepaidReplenishmentTier;
  if (tier !== null && !PREPAID_REPLENISHMENT_TIERS.includes(tier)) throw new Error('Invalid replenishment tier');
  for (const [name, value] of [
    ['credit', input.prepaidCreditReplenishmentAmount],
    ['minutes', input.prepaidBucketReplenishmentMinutes],
  ] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`Invalid replenishment ${name}`);
  }
  if (input.prepaidReplenishmentHorizonDays !== null &&
      (!Number.isInteger(input.prepaidReplenishmentHorizonDays) || input.prepaidReplenishmentHorizonDays < 0 || input.prepaidReplenishmentHorizonDays > 3650)) {
    throw new Error('Invalid replenishment horizon');
  }

  const run = async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const contract = await db.table('client_contracts')
      .where({ client_contract_id: input.clientContractId, client_id: input.clientId })
      .first('client_contract_id');
    if (!contract) throw new Error('Client contract not found');
    await db.table('client_contracts')
      .where({ client_contract_id: input.clientContractId, client_id: input.clientId })
      .update({
        prepaid_replenishment_tier: tier,
        prepaid_credit_replenishment_amount: tier === null ? null : input.prepaidCreditReplenishmentAmount,
        prepaid_bucket_replenishment_minutes: tier === null ? null : input.prepaidBucketReplenishmentMinutes,
        prepaid_replenishment_horizon_days: tier === null ? null : input.prepaidReplenishmentHorizonDays,
        updated_at: trx.fn.now(),
      });
  };
  if (typeof (conn as Knex.Transaction).commit === 'function') return run(conn as Knex.Transaction);
  await (conn as Knex).transaction(run);
}
