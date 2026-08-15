import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ensureDefaultContractForClient } from './defaultContract';

export type ClientBillingSettings = {
  zeroDollarInvoiceHandling?: 'normal' | 'finalized';
  suppressZeroDollarInvoices?: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
  /** The customer holds a credit balance in the external accounting system (e.g. QBO). */
  hasExternalCredit?: boolean;
  /** Free-text shown alongside the flag (e.g. "Paid through Dec 2026 by check"). */
  externalCreditNote?: string | null;
  /** undefined = leave unchanged; true/false = client override; null = revert to tenant default. */
  creditAutoApplyEnabled?: boolean | null;
  /** undefined = leave unchanged; an order = client override; null = revert to tenant default. */
  creditApplicationOrder?: 'expiration_first' | 'oldest_first' | 'newest_first' | null;
  /** null/undefined = inherit tenant default; array = restrict to these service type ids. */
  creditEligibleServiceTypeIds?: string[] | null;
};

type DbClientBillingSettings = {
  tenant: string;
  client_id: string;
  zero_dollar_invoice_handling: 'normal' | 'finalized';
  suppress_zero_dollar_invoices: boolean;
  enable_credit_expiration: boolean;
  credit_expiration_days: number;
  credit_expiration_notification_days: number[];
  has_external_credit: boolean;
  external_credit_note: string | null;
  credit_auto_apply_enabled: boolean | null;
  credit_application_order: string | null;
  credit_eligible_service_type_ids: string[] | null;
};

async function ensureClientBillingSettingsRowInTransaction(
  trx: Knex.Transaction,
  params: { tenant: string; clientId: string }
): Promise<{ created: boolean }> {
  const db = tenantDb(trx, params.tenant);
  const existing = await db.table('client_billing_settings')
    .where({ client_id: params.clientId })
    .select('client_id')
    .first();
  if (existing) {
    await ensureDefaultContractForClient(trx, params);
    return { created: false };
  }

  const defaults = await db.table('default_billing_settings')
    .select(
      'zero_dollar_invoice_handling',
      'suppress_zero_dollar_invoices',
      'credit_expiration_days',
      'credit_expiration_notification_days',
      'enable_credit_expiration'
    )
    .first();

  await db.table('client_billing_settings').insert({
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
  const row = await tenantDb(knexOrTrx, tenant).table<DbClientBillingSettings>('client_billing_settings')
    .where({ client_id: clientId })
    .first()
    .select(
      'zero_dollar_invoice_handling',
      'suppress_zero_dollar_invoices',
      'enable_credit_expiration',
      'credit_expiration_days',
      'credit_expiration_notification_days',
      'has_external_credit',
      'external_credit_note',
      'credit_auto_apply_enabled',
      'credit_application_order',
      'credit_eligible_service_type_ids'
    );

  if (!row) return null;

  return {
    zeroDollarInvoiceHandling: row.zero_dollar_invoice_handling,
    suppressZeroDollarInvoices: row.suppress_zero_dollar_invoices,
    enableCreditExpiration: row.enable_credit_expiration,
    creditExpirationDays: row.credit_expiration_days,
    creditExpirationNotificationDays: row.credit_expiration_notification_days,
    hasExternalCredit: row.has_external_credit,
    externalCreditNote: row.external_credit_note,
    creditAutoApplyEnabled: row.credit_auto_apply_enabled ?? undefined,
    creditApplicationOrder: (row.credit_application_order === 'expiration_first' || row.credit_application_order === 'oldest_first' || row.credit_application_order === 'newest_first')
      ? row.credit_application_order
      : undefined,
    creditEligibleServiceTypeIds: row.credit_eligible_service_type_ids,
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
    await tenantDb(knexOrTrx, tenant).table('client_billing_settings').where({ client_id: clientId }).del();
    return;
  }

  const updates: Record<string, unknown> = {};
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
  if (settings.hasExternalCredit !== undefined) {
    updates.has_external_credit = settings.hasExternalCredit;
  }
  if (settings.externalCreditNote !== undefined) {
    updates.external_credit_note = settings.externalCreditNote;
  }
  if (settings.creditAutoApplyEnabled !== undefined) {
    updates.credit_auto_apply_enabled = settings.creditAutoApplyEnabled;
  }
  if (settings.creditApplicationOrder !== undefined) {
    updates.credit_application_order = settings.creditApplicationOrder;
  }
  if (settings.creditEligibleServiceTypeIds !== undefined) {
    // JSONB: store arrays as JSON strings; null means "no restriction".
    updates.credit_eligible_service_type_ids = settings.creditEligibleServiceTypeIds === null
      ? null
      : JSON.stringify(settings.creditEligibleServiceTypeIds);
  }

  await ensureClientBillingSettingsRow(knexOrTrx, { tenant, clientId });
  await tenantDb(knexOrTrx, tenant).table('client_billing_settings')
    .where({ client_id: clientId })
    .update({ ...updates, updated_at: knexOrTrx.fn.now() });
}

function isKnexTransaction(knexOrTrx: Knex | Knex.Transaction): knexOrTrx is Knex.Transaction {
  return typeof (knexOrTrx as any).commit === 'function' && typeof (knexOrTrx as any).rollback === 'function';
}

export type CreditApplicationOrder = 'expiration_first' | 'oldest_first' | 'newest_first';

export interface CreditDrawdownPolicy {
  autoApplyEnabled: boolean;
  applicationOrder: CreditApplicationOrder;
  /** null = no restriction (all charges eligible); otherwise only these service_type ids. */
  eligibleServiceTypeIds: string[] | null;
}

const CREDIT_APPLICATION_ORDERS: ReadonlySet<string> = new Set([
  'expiration_first',
  'oldest_first',
  'newest_first',
]);

function normalizeCreditApplicationOrder(value: unknown): CreditApplicationOrder {
  return typeof value === 'string' && CREDIT_APPLICATION_ORDERS.has(value)
    ? (value as CreditApplicationOrder)
    : 'expiration_first';
}

function normalizeEligibleServiceTypeIds(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('Malformed credit_eligible_service_type_ids policy: expected a JSON array or null');
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Malformed credit_eligible_service_type_ids policy: expected a JSON array or null');
  }

  return parsed.map((id) => String(id));
}

/**
 * Resolve the credit draw-down policy for a client: per-field first-non-null
 * cascade from `client_billing_settings` over `default_billing_settings` to
 * hardcoded behavior-preserving defaults (auto-apply on, expiration-first,
 * no service-type restriction). Contract opt-out is not part of this cascade;
 * it is a charge-level filter in the apply engine.
 */
export async function resolveCreditDrawdownPolicy(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<CreditDrawdownPolicy> {
  const clientSettings = await tenantDb(knexOrTrx, tenant).table('client_billing_settings')
    .where({ client_id: clientId, tenant })
    .first();

  const defaultSettings = await tenantDb(knexOrTrx, tenant).table('default_billing_settings')
    .first();

  let autoApplyEnabled = true;
  if (typeof clientSettings?.credit_auto_apply_enabled === 'boolean') {
    autoApplyEnabled = clientSettings.credit_auto_apply_enabled;
  } else if (typeof defaultSettings?.credit_auto_apply_enabled === 'boolean') {
    autoApplyEnabled = defaultSettings.credit_auto_apply_enabled;
  }

  let applicationOrder: CreditApplicationOrder = 'expiration_first';
  if (clientSettings?.credit_application_order != null) {
    applicationOrder = normalizeCreditApplicationOrder(clientSettings.credit_application_order);
  } else if (defaultSettings?.credit_application_order != null) {
    applicationOrder = normalizeCreditApplicationOrder(defaultSettings.credit_application_order);
  }

  let eligibleServiceTypeIds: string[] | null = null;
  if (clientSettings?.credit_eligible_service_type_ids != null) {
    eligibleServiceTypeIds = normalizeEligibleServiceTypeIds(clientSettings.credit_eligible_service_type_ids);
  } else if (defaultSettings?.credit_eligible_service_type_ids != null) {
    eligibleServiceTypeIds = normalizeEligibleServiceTypeIds(defaultSettings.credit_eligible_service_type_ids);
  }

  return {
    autoApplyEnabled,
    applicationOrder,
    eligibleServiceTypeIds,
  };
}
