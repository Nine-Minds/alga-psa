/**
 * Transaction-scoped product catalog core.
 *
 * `ProductCatalogService` (REST) and the AMP product applier both create and
 * update products through these functions, so the product invariants (item
 * kind, billing method, unit and tax-rate defaults, GTIN normalisation, the
 * SKU/barcode uniqueness mapping and the pricing writer) live in one place.
 *
 * Everything here runs on a caller-owned transaction: no commit, no auth, no
 * event publication. Callers publish `SERVICE_CATALOG_*` search events after
 * their own commit using the returned `changedFields`.
 *
 * Failures are typed (`ProductCatalogCoreError`); transports map them to their
 * own error classes. Pricing validation failures propagate as
 * `ServiceCatalogPricingError` for the same reason.
 */
import type { Knex } from 'knex';
import { normalizeGtin } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import {
  resolveCatalogUnitForCreate,
  resolveCatalogUnitForUpdate,
} from '@alga-psa/shared/billingClients/tenantUnitsOfMeasure';
import { resolveCatalogTaxRateIdForCreate } from '@alga-psa/shared/billingClients/defaultTaxRate';
import { writeServiceCatalogPricing } from './serviceCatalogPricing';

export type ProductCatalogCoreErrorCode = 'sku_conflict' | 'barcode_conflict' | 'not_found';

export class ProductCatalogCoreError extends Error {
  constructor(
    public readonly code: ProductCatalogCoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProductCatalogCoreError';
  }
}

const SKU_CONFLICT_MESSAGE =
  'A product with this SKU already exists. Use a different SKU or edit the existing product.';
const BARCODE_CONFLICT_MESSAGE =
  'A product with this barcode already exists. Use a different barcode or edit the existing product.';

function rethrowProductUniqueViolation(error: unknown): never {
  const databaseError = error as { code?: string; constraint?: string };
  if (databaseError?.code === '23505') {
    if (databaseError.constraint?.includes('service_catalog_product_barcode_unique')) {
      throw new ProductCatalogCoreError('barcode_conflict', BARCODE_CONFLICT_MESSAGE);
    }
    if (databaseError.constraint?.includes('service_catalog_product_sku_unique')) {
      throw new ProductCatalogCoreError('sku_conflict', SKU_CONFLICT_MESSAGE);
    }
  }
  throw error;
}

/** Free-form product fields. `cost_currency` must already be resolved by the caller. */
export type ProductCoreInput = Record<string, any> & {
  cost_currency: string;
  prices?: unknown;
  scheduled_prices?: unknown;
  unit_of_measure?: string | null;
};

export interface ProductCoreWriteResult<TRow = any> {
  serviceId: string;
  row: TRow;
  changedFields: string[];
}

/** Trimmed SKU the product matcher and the unique index agree on. */
export function normalizeProductSku(sku: string | null | undefined): string | null {
  if (typeof sku !== 'string') return null;
  const trimmed = sku.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Find the tenant's product with this (trimmed) SKU; null when none. */
export async function findProductBySkuCore(
  trx: Knex | Knex.Transaction,
  tenant: string,
  sku: string
): Promise<{ service_id: string; service_name: string; sku: string | null } | null> {
  const normalized = normalizeProductSku(sku);
  if (!normalized) return null;
  const row = await tenantDb(trx, tenant)
    .table('service_catalog')
    .where('item_kind', 'product')
    .whereRaw('btrim(sku) = ?', [normalized])
    .select('service_id', 'service_name', 'sku')
    .orderBy('service_id', 'asc')
    .first();
  return row ?? null;
}

export async function createProductCore(
  trx: Knex.Transaction,
  tenant: string,
  input: ProductCoreInput
): Promise<ProductCoreWriteResult> {
  const {
    prices,
    scheduled_prices: scheduledPrices,
    billing_method: _billingMethod,
    unit_of_measure: unitOfMeasure,
    ...rest
  } = input;

  const productData = {
    ...rest,
    item_kind: 'product',
    billing_method: 'usage',
    ...(await resolveCatalogUnitForCreate(trx, tenant, {
      unit_of_measure: unitOfMeasure,
      unit_code: rest.unit_code,
      item_kind: 'product',
    })),
    tenant,
    default_rate:
      typeof rest.default_rate === 'string' ? parseFloat(rest.default_rate) || 0 : rest.default_rate,
    // Omitted inherits the tenant default; explicit null stays non-taxable.
    tax_rate_id: await resolveCatalogTaxRateIdForCreate(trx, tenant, rest.tax_rate_id, undefined, {
      lock: true,
    }),
    category_id: rest.category_id ?? null,
    barcode: normalizeGtin(rest.barcode ?? '') || null,
  };

  let created: any;
  try {
    [created] = await tenantDb(trx, tenant).table('service_catalog').insert(productData).returning('*');
  } catch (error) {
    rethrowProductUniqueViolation(error);
  }

  // Prices go through the shared catalog pricing writer (billing lock,
  // validation, display order, default_rate mirror) in this transaction.
  if (prices !== undefined || scheduledPrices !== undefined) {
    const { servicePatch } = await writeServiceCatalogPricing(trx, tenant, created.service_id, {
      current: prices as any,
      scheduled: scheduledPrices as any,
    });
    if (servicePatch.default_rate !== undefined) {
      await tenantDb(trx, tenant)
        .table('service_catalog')
        .where('service_id', created.service_id)
        .update(servicePatch);
    }
  }

  return {
    serviceId: created.service_id,
    row: created,
    changedFields: [
      ...Object.keys(productData),
      ...(prices !== undefined ? ['prices'] : []),
      ...(scheduledPrices !== undefined ? ['scheduled_prices'] : []),
    ],
  };
}

export async function updateProductCore(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  patch: Record<string, any>
): Promise<{ serviceId: string; changedFields: string[] }> {
  const {
    prices,
    scheduled_prices: scheduledPrices,
    billing_method: _billingMethod,
    service_type_name: _serviceTypeName,
    ...updateData
  } = patch;

  const existing = await tenantDb(trx, tenant)
    .table('service_catalog')
    .where('service_id', serviceId)
    .select('item_kind')
    .first();
  if (!existing || existing.item_kind !== 'product') {
    throw new ProductCatalogCoreError('not_found', 'Resource not found or permission denied');
  }

  const normalizedUpdateData: Record<string, any> = {
    ...updateData,
    ...(await resolveCatalogUnitForUpdate(trx, tenant, updateData)),
    ...(updateData.barcode !== undefined
      ? { barcode: normalizeGtin(updateData.barcode ?? '') || null }
      : {}),
  };

  if (prices !== undefined || scheduledPrices !== undefined || normalizedUpdateData.default_rate !== undefined) {
    const { servicePatch } = await writeServiceCatalogPricing(trx, tenant, serviceId, {
      current: prices,
      scheduled: scheduledPrices,
      defaultRate:
        normalizedUpdateData.default_rate === undefined ? undefined : Number(normalizedUpdateData.default_rate),
    });
    Object.assign(normalizedUpdateData, servicePatch);
  }

  try {
    await tenantDb(trx, tenant)
      .table('service_catalog')
      .where('service_id', serviceId)
      .update({ ...normalizedUpdateData, item_kind: 'product', billing_method: 'usage' });
  } catch (error) {
    rethrowProductUniqueViolation(error);
  }

  return {
    serviceId,
    changedFields: [
      ...Object.keys(normalizedUpdateData),
      ...(prices !== undefined ? ['prices'] : []),
      ...(scheduledPrices !== undefined ? ['scheduled_prices'] : []),
    ],
  };
}
