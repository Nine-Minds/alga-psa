/**
 * Catalog item matching for price imports: which catalog item does a row mean?
 *
 * `resolveCatalogItemKey` is a pure function over a prepared `CatalogIndex`. The
 * migration planner (bulk pre-load) and the migration applier (re-check inside
 * the apply transaction) both call it, so a preview and an apply cannot disagree.
 *
 * Precedence (docs/plans/2026-11-18-pricebooks-csv-import.md §4.3):
 *  1. `item_ref`, the stable round-trip key (a `service_id`). An unknown ref is
 *     `unmatched`, never a create.
 *  2. Product SKU (unique per tenant, the #3778 rule).
 *  3. Service SKU, then normalised service name, optionally narrowed by service
 *     type. Services have no unique key, so two or more matches are `ambiguous`:
 *     the row is blocked and every candidate is listed. No candidate is ever picked.
 *  4. When a row carries more than one key and they point at different items the
 *     row is a `conflict`.
 *
 * LEVERAGE: pattern catalog-item-key — qboItemResolver's `serviceByName` Map (last duplicate silently wins) is the same question answered unsafely; it can adopt this resolver.
 */

export type CatalogItemKind = 'product' | 'service';

export interface CatalogItem {
  serviceId: string;
  itemKind: CatalogItemKind;
  name: string;
  sku: string | null;
  serviceTypeId: string | null;
  serviceTypeName: string | null;
  billingMethod: string | null;
  isActive: boolean;
}

export interface CatalogIndex {
  byId: ReadonlyMap<string, CatalogItem>;
  productsBySku: ReadonlyMap<string, readonly CatalogItem[]>;
  servicesBySku: ReadonlyMap<string, readonly CatalogItem[]>;
  servicesByName: ReadonlyMap<string, readonly CatalogItem[]>;
}

/** The keys a price row carries. Blank strings count as absent. */
export interface CatalogItemKeyRow {
  itemRef?: string | null;
  itemKind?: CatalogItemKind | null;
  sku?: string | null;
  name?: string | null;
  serviceTypeName?: string | null;
}

export type CatalogItemMatchKey = 'item_ref' | 'product_sku' | 'service_sku' | 'service_name';

export type CatalogItemResolution =
  | { outcome: 'matched'; item: CatalogItem; by: CatalogItemMatchKey; warnings: string[] }
  | { outcome: 'create'; kind: CatalogItemKind; createKey: string; warnings: string[] }
  | { outcome: 'unmatched'; reason: string }
  | { outcome: 'ambiguous'; by: CatalogItemMatchKey; candidates: CatalogItem[] }
  | { outcome: 'conflict'; keys: CatalogItemMatchKey[]; items: CatalogItem[]; reason: string };

export interface ResolveCatalogItemKeyOptions {
  /** Whether a row that matches nothing may create an item (the job has creation configured). */
  allowCreate: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The trimmed SKU the product matcher and the unique index agree on. */
export function normalizeItemSku(sku: string | null | undefined): string | null {
  if (typeof sku !== 'string') return null;
  const trimmed = sku.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Same normalisation as the SQL `lower(btrim(name))`. */
export function normalizeItemName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildCatalogIndex(items: readonly CatalogItem[]): CatalogIndex {
  const byId = new Map<string, CatalogItem>();
  const productsBySku = new Map<string, CatalogItem[]>();
  const servicesBySku = new Map<string, CatalogItem[]>();
  const servicesByName = new Map<string, CatalogItem[]>();
  for (const item of items) {
    byId.set(item.serviceId, item);
    const sku = normalizeItemSku(item.sku);
    if (item.itemKind === 'product') {
      if (sku) push(productsBySku, sku, item);
    } else {
      if (sku) push(servicesBySku, sku, item);
      const name = normalizeItemName(item.name);
      if (name) push(servicesByName, name, item);
    }
  }
  return { byId, productsBySku, servicesBySku, servicesByName };
}

function narrowByType(candidates: readonly CatalogItem[], serviceTypeName: string | null | undefined): CatalogItem[] {
  const wanted = normalizeItemName(serviceTypeName);
  if (!wanted) return [...candidates];
  return candidates.filter((item) => normalizeItemName(item.serviceTypeName) === wanted);
}

/** Dedupe key for "two rows would create the same new item". */
function createKeyFor(kind: CatalogItemKind, sku: string | null, name: string | null): string {
  return sku ? `${kind}:sku:${sku}` : `${kind}:name:${name ?? ''}`;
}

export function resolveCatalogItemKey(
  row: CatalogItemKeyRow,
  index: CatalogIndex,
  options: ResolveCatalogItemKeyOptions,
): CatalogItemResolution {
  const itemRef = row.itemRef?.trim() || null;
  const sku = normalizeItemSku(row.sku);
  const name = normalizeItemName(row.name);
  const declaredKind = row.itemKind ?? null;

  if (!itemRef && !sku && !name) {
    return { outcome: 'unmatched', reason: 'The row has no item ref, SKU or name to identify an item.' };
  }

  // The SKU/name lookup, without item_ref. Returns null when the row has no such key.
  const byOtherKeys = (): CatalogItemResolution => {
    const warnings: string[] = [];
    if (sku && declaredKind !== 'service') {
      const products = index.productsBySku.get(sku) ?? [];
      if (products.length === 1) return { outcome: 'matched', item: products[0], by: 'product_sku', warnings };
      if (products.length > 1) return { outcome: 'ambiguous', by: 'product_sku', candidates: [...products] };
      const serviceWithSku = index.servicesBySku.get(sku) ?? [];
      if (serviceWithSku.length > 0) {
        warnings.push(`Creates a new product; a service with SKU ${sku} exists.`);
      }
      if (!options.allowCreate) {
        return { outcome: 'unmatched', reason: `No product has SKU ${sku}.` };
      }
      return { outcome: 'create', kind: 'product', createKey: createKeyFor('product', sku, name), warnings };
    }

    if (declaredKind === 'product') {
      // A product without a SKU has nothing to match on.
      if (!options.allowCreate || !name) {
        return { outcome: 'unmatched', reason: 'A product row needs a SKU to match an existing product.' };
      }
      return { outcome: 'create', kind: 'product', createKey: createKeyFor('product', null, name), warnings };
    }

    // Service: SKU first, then the name. Neither is unique, so more than one match is ambiguous.
    if (sku) {
      const bySku = narrowByType(index.servicesBySku.get(sku) ?? [], row.serviceTypeName);
      if (bySku.length === 1) return { outcome: 'matched', item: bySku[0], by: 'service_sku', warnings };
      if (bySku.length > 1) return { outcome: 'ambiguous', by: 'service_sku', candidates: bySku };
    }
    if (name) {
      const byName = narrowByType(index.servicesByName.get(name) ?? [], row.serviceTypeName);
      if (byName.length === 1) return { outcome: 'matched', item: byName[0], by: 'service_name', warnings };
      if (byName.length > 1) return { outcome: 'ambiguous', by: 'service_name', candidates: byName };
    }
    if (!options.allowCreate || !name) {
      return { outcome: 'unmatched', reason: name ? 'No service matches this name.' : 'No service matches this SKU.' };
    }
    return { outcome: 'create', kind: 'service', createKey: createKeyFor('service', sku, name), warnings };
  };

  if (!itemRef) return byOtherKeys();

  // item_ref outranks everything, and an unknown ref is never a create.
  const referenced = UUID.test(itemRef) ? index.byId.get(itemRef.toLowerCase()) ?? index.byId.get(itemRef) : undefined;
  if (!referenced) {
    return { outcome: 'unmatched', reason: `Item ref ${itemRef} matches no catalog item.` };
  }
  if (declaredKind && declaredKind !== referenced.itemKind) {
    return {
      outcome: 'conflict',
      keys: ['item_ref'],
      items: [referenced],
      reason: `Item ref ${itemRef} is a ${referenced.itemKind}, but the row says ${declaredKind}.`,
    };
  }
  if (sku) {
    // Other keys must agree with the ref; only the SKU counts as a second key.
    const skuMatches = referenced.itemKind === 'product'
      ? index.productsBySku.get(sku) ?? []
      : index.servicesBySku.get(sku) ?? [];
    const other = skuMatches.filter((item) => item.serviceId !== referenced.serviceId);
    const agrees = skuMatches.some((item) => item.serviceId === referenced.serviceId);
    if (!agrees && other.length > 0) {
      return {
        outcome: 'conflict',
        keys: ['item_ref', referenced.itemKind === 'product' ? 'product_sku' : 'service_sku'],
        items: [referenced, ...other],
        reason: `Item ref ${itemRef} and SKU ${sku} point at different items.`,
      };
    }
  }
  return { outcome: 'matched', item: referenced, by: 'item_ref', warnings: [] };
}

/** Candidate description for an `ambiguous` or `conflict` row, readable without ids. */
export function describeCatalogCandidate(item: CatalogItem): string {
  const parts = [item.name];
  if (item.sku) parts.push(`SKU ${item.sku}`);
  if (item.serviceTypeName) parts.push(item.serviceTypeName);
  if (item.billingMethod) parts.push(item.billingMethod);
  return parts.join(' · ');
}

/**
 * The key under which two rows are "the same price": the matched item (or the
 * item they would both create) and the currency. A second row with the same key
 * is a `CATALOG_PRICE_DUPLICATE_ROW`.
 */
export function catalogPriceRowKey(resolution: CatalogItemResolution, currency: string): string | null {
  if (resolution.outcome === 'matched') return `item:${resolution.item.serviceId}|${currency}`;
  if (resolution.outcome === 'create') return `new:${resolution.createKey}|${currency}`;
  return null;
}
