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
 *
 * - Automatic contract discounts carry the exact per-line allocation the
 *   evaluator resolved in `manual_line_metadata.allocations`.
 * - `applies_to_item_id` targets one line; `applies_to_service_id` a service.
 * - Manual lines tied to a service are scoped to that service's tax region.
 * - Everything else is untargeted: spread over every positive non-discount
 *   line, taxable and exempt alike.
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

export interface DiscountDonorCandidateRow {
  item_id: string;
  net_amount?: number | string | null;
  is_discount?: boolean | null;
  is_taxable?: boolean | null;
  service_id?: string | null;
}

/**
 * When tax is delegated to an external system, a discount line has to carry the
 * tax identity (tax code / tax type) of the taxable charge it reduces, or the
 * external system keeps taxing the full pre-discount amount. A discount row
 * stores no tax identity of its own, so this picks the charge to borrow it
 * from: the targeted charge, else the largest exact allocation, else the
 * largest taxable positive charge (within the targeted service when one is
 * named). Returns null when the discount reduces no taxable charge.
 */
export function discountTaxDonorItemId(
  discount: DiscountPoolSourceRow,
  charges: DiscountDonorCandidateRow[],
): string | null {
  const pool = discountPoolFromInvoiceRow(discount);
  if (!pool) return null;
  const candidates = charges.filter(
    (c) => !c.is_discount && c.is_taxable !== false && Number(c.net_amount || 0) > 0,
  );
  const largest = (rows: DiscountDonorCandidateRow[]) =>
    [...rows].sort(
      (a, b) => Number(b.net_amount) - Number(a.net_amount) || String(a.item_id).localeCompare(String(b.item_id)),
    )[0]?.item_id ?? null;

  if (pool.allocations?.length) {
    const taxableIds = new Set(candidates.map((c) => c.item_id));
    const best = [...pool.allocations]
      .filter((a) => taxableIds.has(a.itemId))
      .sort((a, b) => b.amount - a.amount || a.itemId.localeCompare(b.itemId))[0];
    return best?.itemId ?? null;
  }
  if (pool.target?.itemId) {
    return candidates.find((c) => c.item_id === pool.target!.itemId)?.item_id ?? null;
  }
  if (pool.target?.serviceId) {
    return largest(candidates.filter((c) => c.service_id === pool.target!.serviceId));
  }
  return largest(candidates);
}
