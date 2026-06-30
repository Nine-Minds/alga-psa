import type { IStockLocation } from '@alga-psa/types';

type Occupancy = Pick<IStockLocation, 'on_hand_qty' | 'unit_count'>;

/**
 * A location holds stock if it has any bulk on-hand quantity or any present serialized units — the
 * same two facts the deactivate guard checks. Used to gate the Deactivate action in the UI.
 */
export function isLocationOccupied(loc: Occupancy): boolean {
  return (loc.on_hand_qty ?? 0) > 0 || (loc.unit_count ?? 0) > 0;
}

/**
 * Compact label for the "On hand" column.
 *
 * `on_hand_qty` (SUM of stock_levels.quantity_on_hand) is the canonical total: for serialized
 * products the on-hand cache is recomputed FROM the in-stock unit count, so those units are already
 * in this sum. We must NOT add `unit_count` to it or serialized stock double-counts (a warehouse of
 * 15 phones + 3 SSDs + 4 cables would read "22 · 18 units" instead of the true 22).
 *
 * `unit_count` (present serialized units) is kept only to gate Deactivate and to surface the edge
 * case where units are present but NOT on hand — allocated or in transit, which the recompute
 * excludes — so they show only when the on-hand total is otherwise zero.
 *
 * Returns "Empty", a plain total like "22", or (units-present-but-zero-on-hand) "3 units".
 */
export function formatOnHand(loc: Occupancy): string {
  const qty = loc.on_hand_qty ?? 0;
  const units = loc.unit_count ?? 0;
  if (qty > 0) return `${qty}`;
  if (units > 0) return `${units} unit${units === 1 ? '' : 's'}`;
  return 'Empty';
}
