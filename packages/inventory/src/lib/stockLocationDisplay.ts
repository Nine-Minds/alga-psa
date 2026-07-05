import type { IStockLocation } from '@alga-psa/types';

type Occupancy = Pick<IStockLocation, 'item_type_count' | 'on_hand_qty' | 'unit_count'>;

/**
 * A location holds stock if any product is on hand or any serialized unit is present (the two facts
 * the deactivate guard checks). Used to gate the Deactivate action.
 */
export function isLocationOccupied(loc: Occupancy): boolean {
  return (loc.item_type_count ?? 0) > 0 || (loc.on_hand_qty ?? 0) > 0 || (loc.unit_count ?? 0) > 0;
}

/**
 * The "Stock" column label: the count of DISTINCT products on hand. A summed piece-count across
 * unlike items isn't a meaningful quantity (15 phones + 4 cables ≠ "19 of" anything), and an inline
 * breakdown can't survive hundreds of types — so the row shows how many *kinds* are stocked and the
 * actual contents live behind the drill-in. Returns "Empty", "1 product", "12 products", or — for the
 * edge where units are present but not on hand (allocated / in transit) — "3 units".
 */
export function formatStock(loc: Occupancy): string {
  const types = loc.item_type_count ?? 0;
  if (types > 0) return `${types} product${types === 1 ? '' : 's'}`;
  const units = loc.unit_count ?? 0;
  if (units > 0) return `${units} unit${units === 1 ? '' : 's'}`;
  return 'Empty';
}

/**
 * The coarse one-line total for the drill-in header, e.g. "12 products · 340 on hand". The piece
 * total is acknowledged-coarse (it sums across types) but is fine as context above the itemized list.
 */
export function formatStockSummary(loc: Occupancy): string {
  const types = loc.item_type_count ?? 0;
  const qty = loc.on_hand_qty ?? 0;
  if (types === 0 && qty === 0) return 'Nothing on hand';
  const typeLabel = `${types} product${types === 1 ? '' : 's'}`;
  return `${typeLabel} · ${qty} on hand`;
}
