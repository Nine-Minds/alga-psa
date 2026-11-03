import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  DEFAULT_PAYMENT_TERMS,
  normalizePaymentTerms,
  type PaymentTerms,
} from './paymentPreferences';

/**
 * The tenant's default payment terms (`default_billing_settings.default_payment_terms`).
 *
 * This is the only module that reads the column. The settings action, the
 * effective billing identity, the REST service, the CSV export and the client
 * lookups all go through it.
 *
 * The settings row is optional (one per tenant, may be absent) and the column
 * is unconstrained text, so NULL, a missing row and an unrecognised value all
 * mean "not set".
 */

/** The tenant's configured default terms, or null when unset/unrecognised. */
export async function readTenantDefaultPaymentTerms(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<PaymentTerms | null> {
  const row = await tenantDb(knex, tenant)
    .table('default_billing_settings')
    .first('default_payment_terms');
  return normalizePaymentTerms(row?.default_payment_terms);
}

/** Terms used when profile and client hold none: tenant default, else DEFAULT_PAYMENT_TERMS. */
export async function resolveTenantDefaultPaymentTerms(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<PaymentTerms> {
  return (await readTenantDefaultPaymentTerms(knex, tenant)) ?? DEFAULT_PAYMENT_TERMS;
}
