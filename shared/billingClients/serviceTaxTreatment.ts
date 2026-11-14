import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Tax treatment a catalog-backed line inherits from its service. */
export type ServiceTaxTreatment = {
  isTaxable: boolean;
  taxRegion: string | null;
};

/**
 * Region a service's tax rate selects. Same semantics as
 * `invoiceService.resolveTaxRegionCodeForRate`: an unknown or foreign rate id
 * yields null so the line is never silently taxed in the wrong region.
 */
export async function resolveTaxRegionCodeForRate(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string
): Promise<string | null> {
  const rate = await tenantDb(knexOrTrx, tenant)
    .table<{ tenant?: string; tax_rate_id?: string; region_code?: string | null }>('tax_rates')
    .where({ tax_rate_id: taxRateId })
    .first('region_code');
  return rate?.region_code ?? null;
}

/**
 * Tax treatment a catalog-backed line inherits from its service, mirroring the
 * manual-invoice-charge rule in `invoiceService`: a service with no
 * `tax_rate_id` is non-taxable, a service with one is taxed in that rate's
 * region, and a rate id that resolves to no tenant row is non-taxable rather
 * than taxed in an unknown region.
 *
 * Shared by `packages/billing` QuoteItem and the workflow-runtime CRM DAL so
 * both quote-item creation paths derive the same treatment.
 */
export async function deriveServiceTaxTreatment(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string | null | undefined
): Promise<ServiceTaxTreatment> {
  if (!taxRateId) {
    return { isTaxable: false, taxRegion: null };
  }

  const taxRegion = await resolveTaxRegionCodeForRate(knexOrTrx, tenant, taxRateId);
  return { isTaxable: taxRegion != null, taxRegion };
}
