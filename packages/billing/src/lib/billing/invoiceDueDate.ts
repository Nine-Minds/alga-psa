import type { Knex } from 'knex';
import type { ISO8601String } from '@alga-psa/types';
import { toISODate, toPlainDate } from '@alga-psa/core';
import { resolveEffectiveBillingIdentity } from '@alga-psa/shared/billingClients/billingProfileSettings';
import { paymentTermDays } from '@alga-psa/shared/billingClients/paymentPreferences';

/**
 * Invoice due dates follow the payment terms of the billing profile that the
 * invoice bills. The terms resolve field by field, profile first and then
 * client, so a client with no profile overrides gets exactly the due date it
 * always got.
 */

/** Due date for an invoice dated `invoiceDate` under `paymentTerms` (unknown terms → Net 30). */
export function dueDateForPaymentTerms(
  invoiceDate: ISO8601String,
  paymentTerms: string | null | undefined,
): ISO8601String {
  return toISODate(toPlainDate(invoiceDate).add({ days: paymentTermDays(paymentTerms) }));
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
  const identity = await resolveEffectiveBillingIdentity(knex, tenant, clientId, billingProfileId);
  return dueDateForPaymentTerms(invoiceDate, identity.paymentTerms);
}
