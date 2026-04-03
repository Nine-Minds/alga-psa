import type { Knex } from 'knex';
import { ensureDefaultContractForClient } from './defaultContract';

export type ClientBillingSettings = {
  zeroDollarInvoiceHandling?: 'normal' | 'finalized';
  suppressZeroDollarInvoices?: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
};

type DbClientBillingSettings = {
  tenant: string;
  client_id: string;
  zero_dollar_invoice_handling: 'normal' | 'finalized';
  suppress_zero_dollar_invoices: boolean;
  enable_credit_expiration: boolean;
  credit_expiration_days: number;
  credit_expiration_notification_days: number[];
};

async function ensureClientBillingSettingsRowInTransaction(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string }
): Promise<{ created: boolean }> {
  const existing = await trx('client_billing_settings')
    .where({ tenant: params.tenant, client_id: params.clientId })
    .select('client_id')
    .first();
  if (existing) {
    await ensureDefaultContractForClient(trx, params);
    return { created: false };
  }

  const defaults = await trx('default_billing_settings')
    .where({ tenant: params.tenant })
    .first()
    .select(
      'zero_dollar_invoice_handling',
      'suppress_zero_dollar_invoices',
      'credit_expiration_days',
      'credit_expiration_notification_days',
      'enable_credit_expiration'
    );

  await trx('client_billing_settings').insert({
    tenant: params.tenant,
    client_id: params.clientId,
    zero_dollar_invoice_handling: defaults?.zero_dollar_invoice_handling ?? 'normal',
    suppress_zero_dollar_invoices: defaults?.suppress_zero_dollar_invoices ?? false,
    credit_expiration_days: defaults?.credit_expiration_days ?? 365,
    credit_expiration_notification_days: defaults?.credit_expiration_notification_days ?? [30, 7, 1],
    enable_credit_expiration: defaults?.enable_credit_expiration ?? true,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });

  await ensureDefaultContractForClient(trx, params);
  return { created: true };
}

export async function ensureClientBillingSettingsRow(
  knexOrTrx: Knex | Knex.Transaction,
  params: { tenant: string; clientId: string }
): Promise<{ created: boolean }> {
  if (isKnexTransaction(knexOrTrx)) {
    return ensureClientBillingSettingsRowInTransaction(knexOrTrx, params);
  }

  return (knexOrTrx as Knex).transaction(async (trx) =>
    ensureClientBillingSettingsRowInTransaction(trx, params)
  );
}

export async function getClientBillingSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<ClientBillingSettings | null> {
  const row = await knexOrTrx<DbClientBillingSettings>('client_billing_settings')
    .where({ tenant, client_id: clientId })
    .first()
    .select(
      'zero_dollar_invoice_handling',
      'suppress_zero_dollar_invoices',
      'enable_credit_expiration',
      'credit_expiration_days',
      'credit_expiration_notification_days'
    );

  if (!row) return null;

  return {
    zeroDollarInvoiceHandling: row.zero_dollar_invoice_handling,
    suppressZeroDollarInvoices: row.suppress_zero_dollar_invoices,
    enableCreditExpiration: row.enable_credit_expiration,
    creditExpirationDays: row.credit_expiration_days,
    creditExpirationNotificationDays: row.credit_expiration_notification_days,
  };
}

export async function updateClientBillingSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  settings: ClientBillingSettings | null
): Promise<void> {
  if (!isKnexTransaction(knexOrTrx)) {
    await (knexOrTrx as Knex).transaction(async (trx) => {
      await updateClientBillingSettings(trx, tenant, clientId, settings);
    });
    return;
  }

  if (settings === null) {
    await knexOrTrx('client_billing_settings').where({ tenant, client_id: clientId }).del();
    return;
  }

  const updates: Partial<DbClientBillingSettings> = {};
  if (settings.zeroDollarInvoiceHandling !== undefined) {
    updates.zero_dollar_invoice_handling = settings.zeroDollarInvoiceHandling;
  }
  if (settings.suppressZeroDollarInvoices !== undefined) {
    updates.suppress_zero_dollar_invoices = settings.suppressZeroDollarInvoices;
  }
  if (settings.enableCreditExpiration !== undefined) {
    updates.enable_credit_expiration = settings.enableCreditExpiration;
  }
  if (settings.creditExpirationDays !== undefined) {
    updates.credit_expiration_days = settings.creditExpirationDays;
  }
  if (settings.creditExpirationNotificationDays !== undefined) {
    updates.credit_expiration_notification_days = settings.creditExpirationNotificationDays;
  }

  await ensureClientBillingSettingsRow(knexOrTrx, { tenant, clientId });
  await knexOrTrx('client_billing_settings')
    .where({ tenant, client_id: clientId })
    .update({ ...updates, updated_at: knexOrTrx.fn.now() });
}

function isKnexTransaction(knexOrTrx: Knex | Knex.Transaction): knexOrTrx is Knex.Transaction {
  return typeof (knexOrTrx as any).commit === 'function' && typeof (knexOrTrx as any).rollback === 'function';
}
