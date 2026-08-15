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

export const prepaidBalanceAlertSettingsInputSchema = z.object({
  clientId: z.string().min(1),
  prepaidCreditAlertThreshold: z.number().int().positive().nullable(),
  prepaidCreditAlertCurrencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Currency code must be three uppercase letters')
    .nullable(),
  bucketUsageAlertPercent: z.number().int().min(1).max(100).nullable(),
  notifyClientOnPrepaidAlert: z.boolean(),
});

export type PrepaidBalanceAlertSettingsInput = z.infer<typeof prepaidBalanceAlertSettingsInputSchema>;

export interface PrepaidBalanceAlertSettings {
  prepaidCreditAlertThreshold: number | null;
  prepaidCreditAlertCurrencyCode: string | null;
  bucketUsageAlertPercent: number | null;
  notifyClientOnPrepaidAlert: boolean;
}

/** Read result: the persisted policy plus the client default currency when no policy exists. */
export interface PrepaidBalanceAlertSettingsWithDefault extends PrepaidBalanceAlertSettings {
  defaultCurrencyCode?: string;
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
  };
  if (client?.default_currency_code) {
    result.defaultCurrencyCode = client.default_currency_code;
  }
  return result;
}

/**
 * Persist only the four prepaid-alert policy columns. This deliberately does
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
  const { clientId, prepaidCreditAlertThreshold, prepaidCreditAlertCurrencyCode, bucketUsageAlertPercent } = parsed;
  const bothDisabled =
    prepaidCreditAlertThreshold === null &&
    prepaidCreditAlertCurrencyCode === null &&
    bucketUsageAlertPercent === null;
  const notifyClientOnPrepaidAlert = bothDisabled ? false : parsed.notifyClientOnPrepaidAlert;

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
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .onConflict(['tenant', 'client_id'])
      .merge({
        prepaid_credit_alert_threshold: prepaidCreditAlertThreshold,
        prepaid_credit_alert_currency_code: prepaidCreditAlertCurrencyCode,
        bucket_usage_alert_percent: bucketUsageAlertPercent,
        notify_client_on_prepaid_alert: notifyClientOnPrepaidAlert,
        updated_at: trx.fn.now(),
      });
  };

  if (typeof (conn as Knex.Transaction).commit === 'function') {
    await run(conn as Knex.Transaction);
    return;
  }
  await (conn as Knex).transaction((trx) => run(trx));
}
