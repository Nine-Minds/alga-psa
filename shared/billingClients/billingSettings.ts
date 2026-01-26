import type { Knex } from 'knex';

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

async function ensureClientBillingSettingsRow(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string }
): Promise<void> {
  const existing = await trx('client_billing_settings')
    .where({ tenant: params.tenant, client_id: params.clientId })
    .first()
    .select('client_id');
  if (existing) return;

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

  if ('transaction' in knexOrTrx) {
    // noop: type narrowing aid
  }

  if (typeof (knexOrTrx as any).transaction === 'function') {
    // not reliable; skip
  }

  if (isKnexTransaction(knexOrTrx)) {
    await ensureClientBillingSettingsRow(knexOrTrx, { tenant, clientId });
    await knexOrTrx('client_billing_settings')
      .where({ tenant, client_id: clientId })
      .update({ ...updates, updated_at: knexOrTrx.fn.now() });
    return;
  }

  // If the caller isn't in a transaction, just upsert via a one-off insert/update pattern.
  const existing = await knexOrTrx('client_billing_settings').where({ tenant, client_id: clientId }).first('client_id');
  if (!existing) {
    await knexOrTrx('client_billing_settings').insert({
      tenant,
      client_id: clientId,
      zero_dollar_invoice_handling: updates.zero_dollar_invoice_handling ?? 'normal',
      suppress_zero_dollar_invoices: updates.suppress_zero_dollar_invoices ?? false,
      credit_expiration_days: updates.credit_expiration_days ?? 365,
      credit_expiration_notification_days: updates.credit_expiration_notification_days ?? [30, 7, 1],
      enable_credit_expiration: updates.enable_credit_expiration ?? true,
      created_at: (knexOrTrx as any).fn.now(),
      updated_at: (knexOrTrx as any).fn.now()
    });
    return;
  }

  await knexOrTrx('client_billing_settings')
    .where({ tenant, client_id: clientId })
    .update({ ...updates, updated_at: (knexOrTrx as any).fn.now() });
}

function isKnexTransaction(knexOrTrx: Knex | Knex.Transaction): knexOrTrx is Knex.Transaction {
  return typeof (knexOrTrx as any).commit === 'function' && typeof (knexOrTrx as any).rollback === 'function';
}
