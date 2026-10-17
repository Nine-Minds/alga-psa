import type { Knex } from 'knex';
import type { IVendorProduct } from '@alga-psa/types';
import { resolveTenantCurrency } from './tenantCurrency';

export interface UpsertVendorProductInput {
  vendor_id: string;
  service_id: string;
  vendor_sku?: string | null;
  unit_cost?: number | null; // integer minor units
  /** Omitted: the tenant billing currency. Callers that must not guess pass it explicitly. */
  cost_currency?: string;
  lead_time_days?: number | null;
  is_preferred?: boolean;
}

/**
 * Transaction-scoped vendor-offer upsert. Owns the (vendor, product) upsert
 * key, the single-preferred-offer rule (backed by a partial unique index), the
 * preferred-vendor sync into product_inventory_settings, and the cost-currency
 * default. Validation failures throw Errors with the messages the vendor-product
 * action maps to translated results.
 */
export async function upsertVendorProductCore(
  trx: Knex.Transaction,
  tenant: string,
  input: UpsertVendorProductInput,
): Promise<IVendorProduct> {
  if (!input.vendor_id || !input.service_id) throw new Error('vendor_id and service_id are required');
  if (input.unit_cost != null && (!Number.isInteger(input.unit_cost) || input.unit_cost < 0)) {
    throw new Error('unit_cost must be a non-negative integer (cents)');
  }

  const costCurrency = input.cost_currency?.trim() || await resolveTenantCurrency(trx, tenant);
  if (input.is_preferred) {
    // Single preferred offer per product (backed by the partial unique index).
    await trx('vendor_products')
      .where({ tenant, service_id: input.service_id, is_preferred: true })
      .andWhereNot({ vendor_id: input.vendor_id })
      .update({ is_preferred: false, updated_at: trx.fn.now() });
  }
  const [row] = await trx('vendor_products')
    .insert({
      tenant,
      vendor_id: input.vendor_id,
      service_id: input.service_id,
      vendor_sku: input.vendor_sku?.trim() || null,
      unit_cost: input.unit_cost ?? null,
      cost_currency: costCurrency,
      lead_time_days: input.lead_time_days ?? null,
      is_preferred: input.is_preferred ?? false,
    })
    .onConflict(['tenant', 'vendor_id', 'service_id'])
    // Citus rejects STABLE functions (trx.fn.now() → CURRENT_TIMESTAMP) inside
    // ON CONFLICT DO UPDATE SET on distributed tables — must pass a literal.
    .merge({
      vendor_sku: input.vendor_sku?.trim() || null,
      unit_cost: input.unit_cost ?? null,
      cost_currency: costCurrency,
      lead_time_days: input.lead_time_days ?? null,
      is_preferred: input.is_preferred ?? false,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  // Keep the settings-level preferred vendor in sync — reorder grouping reads it.
  if (input.is_preferred) {
    await trx('product_inventory_settings')
      .where({ tenant, service_id: input.service_id })
      .update({ preferred_vendor_id: input.vendor_id, updated_at: trx.fn.now() });
  }
  return row as IVendorProduct;
}
