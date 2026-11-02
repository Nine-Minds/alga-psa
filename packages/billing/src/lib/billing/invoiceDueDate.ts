import type { Knex } from 'knex';
import type { ISO8601String } from '@alga-psa/types';
import { toISODate, toPlainDate } from '@alga-psa/core';
import { resolveEffectiveBillingIdentity } from '@alga-psa/shared/billingClients/billingProfileSettings';
import { paymentTermDays, type PreferredPaymentMethod } from '@alga-psa/shared/billingClients/paymentPreferences';

/**
 * Invoice due dates follow the payment terms of the billing profile that the
 * invoice bills. The terms resolve field by field: the profile, then the
 * client, then the tenant default (Billing Settings), then Net 30. A client
 * with no profile overrides and a tenant with no default gets exactly the due
 * date it always got.
 */

/** Due date for an invoice dated `invoiceDate` under `paymentTerms` (unknown terms → Net 30).
 * Pure arithmetic over an already-resolved term; the profile → client → tenant
 * default resolution happens in `resolveEffectiveBillingIdentity`. */
export function dueDateForPaymentTerms(
  invoiceDate: ISO8601String,
  paymentTerms: string | null | undefined,
): ISO8601String {
  return toISODate(toPlainDate(invoiceDate).add({ days: paymentTermDays(paymentTerms) }));
}

/** Terms an invoice header carries, taken from the effective billing identity. */
export interface InvoiceBillingTerms {
  /** The profile actually resolved: the one passed in, else the client default. */
  billingProfileId: string;
  dueDate: ISO8601String;
  paymentMethod: PreferredPaymentMethod | null;
}

/**
 * Header terms (profile, due date, payment method) for an invoice billed under
 * `billingProfileId`, or under the client's default profile when none is given.
 * Fields resolve profile first, then client. Runs on the caller's transaction;
 * resolving the default profile may write (lazy provision) inside it.
 *
 * `invoiceDate` may be an ISO date or a full ISO timestamp; a timestamp is
 * reduced to its UTC calendar date before the term days are added.
 */
export async function resolveInvoiceBillingTerms(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  invoiceDate: ISO8601String,
  billingProfileId?: string | null,
): Promise<InvoiceBillingTerms> {
  const identity = await resolveEffectiveBillingIdentity(trx, tenant, clientId, billingProfileId);
  return {
    billingProfileId: identity.billingProfileId,
    dueDate: dueDateForPaymentTerms(invoiceDate, identity.paymentTerms),
    paymentMethod: identity.preferredPaymentMethod,
  };
}

/**
 * Due date for an invoice billed under `billingProfileId`, or under the
 * client's default profile when no profile is given (manual, hour-block, and
 * sales-order invoices, which bill the client as a whole).
 */
export async function resolveInvoiceDueDate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  invoiceDate: ISO8601String,
  billingProfileId?: string | null,
): Promise<ISO8601String> {
  return (await resolveInvoiceBillingTerms(knex, tenant, clientId, invoiceDate, billingProfileId)).dueDate;
}
