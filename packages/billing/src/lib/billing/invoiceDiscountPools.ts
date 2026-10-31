import type { DiscountPool } from '../discountAllocationBeforeTax';

/** The columns of an invoice discount / negative row that decide how it is scoped. */
export interface DiscountPoolSourceRow {
  item_id: string;
  net_amount?: number | string | null;
  manual_line_metadata?: unknown;
  adjustment_source_kind?: string | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
  is_manual?: boolean | null;
  service_id?: string | null;
  tax_region?: string | null;
}

/**
 * Turns one discount / negative invoice row into a pool for
 * `allocateDiscountsBeforeTax`. Shared by invoice tax calculation and the
 * accounting adapters so both read a row's scope identically.
 */
export function discountPoolFromInvoiceRow(item: DiscountPoolSourceRow): DiscountPool | null {
  const amount = -Number(item.net_amount || 0);
  if (!(amount > 0)) return null;

  let metadata: unknown = item.manual_line_metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = null; }
  }
  const rawAllocations = (metadata as { allocations?: unknown } | null)?.allocations;
  const allocations = Array.isArray(rawAllocations)
    ? rawAllocations
        .map((entry: any) => ({ itemId: String(entry?.itemId ?? ''), amount: Number(entry?.amount ?? 0) }))
        .filter((entry) => entry.itemId && entry.amount > 0)
    : [];

  if (item.adjustment_source_kind === 'discount' && allocations.length > 0) {
    return { id: item.item_id, amount, allocations };
  }
  if (item.applies_to_item_id) {
    return { id: item.item_id, amount, target: { itemId: item.applies_to_item_id } };
  }
  if (item.applies_to_service_id) {
    return { id: item.item_id, amount, target: { serviceId: item.applies_to_service_id } };
  }
  if (item.is_manual && item.service_id && item.tax_region) {
    return { id: item.item_id, amount, region: item.tax_region };
  }
  return { id: item.item_id, amount };
}
