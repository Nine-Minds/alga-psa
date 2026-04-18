/**
 * Shared helpers for "group line items by location" rendering used by
 * quote / invoice / contract surfaces. The single source of truth for
 * the flat-vs-grouped auto-flip decision.
 *
 * Rule: 1 distinct location (or 0) → flat layout; ≥2 distinct → grouped.
 */

import type { BillingLocationSummary } from '../../../actions/billingClientLocationActions';

export type LocationSummary = BillingLocationSummary;

export type LocationBearingItem = {
  location_id?: string | null;
};

export type LocationGroupEntry<T extends LocationBearingItem> = {
  /**
   * Stable key for React reconciliation. Equal to the `location_id` string,
   * or the sentinel `__unassigned__` for items with no location.
   */
  key: string;
  location_id: string | null;
  location: LocationSummary | null;
  items: T[];
};

export const UNASSIGNED_LOCATION_KEY = '__unassigned__';

export const getLocationKey = (locationId: string | null | undefined): string =>
  locationId && locationId.trim().length > 0 ? locationId : UNASSIGNED_LOCATION_KEY;

/**
 * Distinct, non-null location_ids among the provided items.
 */
export function collectDistinctLocationIds<T extends LocationBearingItem>(items: T[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const id = item.location_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * The auto-flip decision. `true` ⇒ render grouped with per-location subtotals.
 */
export function shouldShowLocationGroups<T extends LocationBearingItem>(items: T[]): boolean {
  return collectDistinctLocationIds(items).length >= 2;
}

/**
 * Group items by `location_id`, preserving first-seen order, and attach the
 * resolved `LocationSummary` for each group when available.
 */
export function buildLocationGroups<T extends LocationBearingItem>(
  items: T[],
  locations: LocationSummary[],
): LocationGroupEntry<T>[] {
  const locationById = new Map<string, LocationSummary>();
  for (const location of locations) {
    if (location?.location_id) {
      locationById.set(location.location_id, location);
    }
  }

  const order: string[] = [];
  const grouped = new Map<string, LocationGroupEntry<T>>();

  for (const item of items) {
    const key = getLocationKey(item.location_id ?? null);
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        key,
        location_id: key === UNASSIGNED_LOCATION_KEY ? null : key,
        location: key === UNASSIGNED_LOCATION_KEY ? null : locationById.get(key) ?? null,
        items: [],
      };
      grouped.set(key, entry);
      order.push(key);
    }
    entry.items.push(item);
  }

  return order.map((key) => grouped.get(key)!);
}

/**
 * Pretty-print a location as a single line: "Name — address line 1, city, ST".
 * Used by pickers and headers. Intentionally concise; full address goes on the PDF.
 */
export function formatLocationSummaryLabel(location: LocationSummary | null | undefined): string {
  if (!location) return '';
  const parts: string[] = [];
  const name = (location.location_name || '').trim();
  if (name) parts.push(name);

  const addressBits = [location.address_line1, location.city, location.state_province]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);

  if (addressBits.length > 0) {
    const addressLine = addressBits.join(', ');
    return parts.length > 0 ? `${parts[0]} — ${addressLine}` : addressLine;
  }

  return parts[0] ?? '';
}

/**
 * Multi-line full address for group headers / PDF bands.
 */
export function formatLocationAddressBlock(location: LocationSummary | null | undefined): string[] {
  if (!location) return [];

  const lines: string[] = [];
  const street1 = (location.address_line1 || '').trim();
  const street2 = (location.address_line2 || '').trim();
  const street3 = (location.address_line3 || '').trim();
  if (street1) lines.push(street1);
  if (street2) lines.push(street2);
  if (street3) lines.push(street3);

  const cityLineParts: string[] = [];
  if (location.city) cityLineParts.push(location.city.trim());
  if (location.state_province) cityLineParts.push(location.state_province.trim());
  if (location.postal_code) cityLineParts.push(location.postal_code.trim());
  const cityLine = cityLineParts.filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);

  const country = (location.country_name || location.country_code || '').trim();
  if (country) lines.push(country);

  return lines.filter((line) => line.length > 0);
}

export function pickDefaultLocation(locations: LocationSummary[]): LocationSummary | null {
  if (!locations || locations.length === 0) return null;
  return (
    locations.find((location) => location.is_default) ??
    locations.find((location) => location.is_billing_address) ??
    locations[0] ??
    null
  );
}
