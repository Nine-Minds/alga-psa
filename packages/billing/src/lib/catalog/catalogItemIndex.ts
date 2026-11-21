import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  buildCatalogIndex,
  normalizeItemName,
  normalizeItemSku,
  type CatalogIndex,
  type CatalogItem,
  type CatalogItemKeyRow,
} from './catalogItemKey';

/**
 * Load the catalog items any of the given rows could resolve to, as a
 * `CatalogIndex` for `resolveCatalogItemKey`. One set-based query: it fetches
 * only items that share a ref, SKU or name with some row, never the whole catalog.
 * The planner calls it once for the job; the applier calls it per row with the
 * apply transaction, so both read the same rules.
 */
export async function loadCatalogIndex(
  trx: Knex | Knex.Transaction,
  tenant: string,
  rows: readonly CatalogItemKeyRow[],
): Promise<CatalogIndex> {
  const refs = new Set<string>();
  const skus = new Set<string>();
  const names = new Set<string>();
  for (const row of rows) {
    const ref = row.itemRef?.trim();
    if (ref) refs.add(ref.toLowerCase());
    const sku = normalizeItemSku(row.sku);
    if (sku) skus.add(sku);
    const name = normalizeItemName(row.name);
    if (name) names.add(name);
  }
  if (refs.size === 0 && skus.size === 0 && names.size === 0) return buildCatalogIndex([]);

  const refList = [...refs].filter((ref) => /^[0-9a-f-]{36}$/.test(ref));
  const db = tenantDb(trx, tenant);
  const records = await db
    .tenantJoin(db.table('service_catalog as sc'), 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' })
    .where((query) => {
      if (refList.length > 0) query.orWhereIn('sc.service_id', refList);
      if (skus.size > 0) query.orWhereRaw('btrim(sc.sku) = ANY(?)', [[...skus]]);
      if (names.size > 0) query.orWhereRaw("sc.item_kind = 'service' AND lower(btrim(sc.service_name)) = ANY(?)", [[...names]]);
    })
    .select(
      'sc.service_id',
      'sc.service_name',
      'sc.sku',
      'sc.item_kind',
      'sc.custom_service_type_id',
      'sc.billing_method',
      'sc.is_active',
      'st.name as service_type_name',
    );

  const items: CatalogItem[] = records.map((record: Record<string, any>) => ({
    serviceId: String(record.service_id),
    itemKind: record.item_kind === 'product' ? 'product' : 'service',
    name: String(record.service_name ?? ''),
    sku: record.sku ?? null,
    serviceTypeId: record.custom_service_type_id ?? null,
    serviceTypeName: record.service_type_name ?? null,
    billingMethod: record.billing_method ?? null,
    isActive: record.is_active !== false,
  }));
  return buildCatalogIndex(items);
}
