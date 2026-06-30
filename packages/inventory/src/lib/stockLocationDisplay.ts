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
 * Compact occupancy label for the "On hand" column: bulk quantity and/or serialized unit count.
 * Returns "Empty" when the location holds nothing; otherwise "142", "12 units", or "142 · 12 units".
 */
export function formatOnHand(loc: Occupancy): string {
  const qty = loc.on_hand_qty ?? 0;
  const units = loc.unit_count ?? 0;
  if (qty === 0 && units === 0) return 'Empty';
  const parts: string[] = [];
  if (qty > 0) parts.push(`${qty}`);
  if (units > 0) parts.push(`${units} unit${units === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
