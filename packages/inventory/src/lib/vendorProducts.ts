import type { Knex } from 'knex';
import type { IVendorProduct } from '@alga-psa/types';
import { resolveTenantCurrency } from './tenantCurrency';
import { VendorCoreError } from './vendorErrors';

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
 * default. Failures throw VendorCoreError with the messages the vendor-product
 * action maps to translated results (VendorCoreError carries a kind and code).
 */
export async function upsertVendorProductCore(
  trx: Knex.Transaction,
  tenant: string,
  input: UpsertVendorProductInput,
): Promise<IVendorProduct> {
  if (!input.vendor_id || !input.service_id) {
    throw new VendorCoreError('validation', 'vendor_and_product_required', 'vendor_id and service_id are required');
  }
  if (input.unit_cost != null && (!Number.isInteger(input.unit_cost) || input.unit_cost < 0)) {
    throw new VendorCoreError('validation', 'unit_cost_invalid', 'unit_cost must be a non-negative integer (cents)', { field: 'unit_cost' });
  }

  const vendor = await trx('vendors').where({ tenant, vendor_id: input.vendor_id }).first('vendor_id');
  if (!vendor) throw new VendorCoreError('not_found', 'vendor_not_found', 'Vendor not found');
  const product = await trx('service_catalog').where({ tenant, service_id: input.service_id }).first('service_id');
  if (!product) throw new VendorCoreError('not_found', 'product_not_found', 'Product not found');

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

export type VendorProductListRow = IVendorProduct & {
  service_name: string | null;
  sku: string | null;
  vendor_name: string | null;
};

/** Price list rows with product name and SKU, ordered by product name. */
export async function queryVendorProducts(
  trx: Knex.Transaction,
  tenant: string,
  filter?: { vendor_id?: string; service_id?: string },
): Promise<VendorProductListRow[]> {
  const q = trx('vendor_products as vp')
    .leftJoin('service_catalog as sc', function () {
      this.on('sc.service_id', '=', 'vp.service_id').andOn('sc.tenant', '=', 'vp.tenant');
    })
    .leftJoin('vendors as v', function () {
      this.on('v.vendor_id', '=', 'vp.vendor_id').andOn('v.tenant', '=', 'vp.tenant');
    })
    .where('vp.tenant', tenant)
    .select('vp.*', 'sc.service_name', 'sc.sku', 'v.vendor_name')
    .orderBy('sc.service_name', 'asc');
  if (filter?.vendor_id) q.andWhere('vp.vendor_id', filter.vendor_id);
  if (filter?.service_id) q.andWhere('vp.service_id', filter.service_id);
  return (await q) as VendorProductListRow[];
}

/** Remove one price list entry. `removed` is false when there was no such entry. */
export async function deleteVendorProductCore(
  trx: Knex.Transaction,
  tenant: string,
  vendorId: string,
  serviceId: string,
): Promise<{ removed: boolean }> {
  const removed = await trx('vendor_products')
    .where({ tenant, vendor_id: vendorId, service_id: serviceId })
    .del();
  return { removed: removed > 0 };
}
