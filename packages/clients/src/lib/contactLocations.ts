import type { Knex } from 'knex';
import type { IContactLocation } from '@alga-psa/types';
import { getContactLocationsForContacts } from '../models/contactLocation';

export type WithContactLocations<T> = T & {
  locations: IContactLocation[];
  primaryLocation: Pick<IContactLocation, 'location_id' | 'location_name'> | null;
};

/**
 * Adds `locations` and `primaryLocation` to picker and list rows. One batched read per page, the
 * sibling of `attachDisplayTags`; rows with no links get `[]` and `null` so no caller has to tell
 * "not loaded" from "none". `primaryLocation` is the primary link, or the only one — the loader
 * already returns the primary first.
 */
export async function attachContactLocations<T extends object>(
  db: Knex | Knex.Transaction,
  tenant: string,
  rows: readonly T[],
  idOf: (row: T) => string | null | undefined,
): Promise<Array<WithContactLocations<T>>> {
  if (rows.length === 0) return [];
  const byContact = await getContactLocationsForContacts(db, tenant, rows.map(idOf).filter((id): id is string => Boolean(id)));

  return rows.map((row) => {
    const id = idOf(row);
    const locations = (id ? byContact.get(id) : undefined) ?? [];
    const primary = locations.find((location) => location.is_primary) ?? (locations.length === 1 ? locations[0] : null);
    return {
      ...row,
      locations,
      primaryLocation: primary ? { location_id: primary.location_id, location_name: primary.location_name } : null,
    };
  });
}
