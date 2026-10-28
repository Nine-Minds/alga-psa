import { tenantDb } from '@alga-psa/db';
import type { ContactLocationInput, IContactLocation } from '@alga-psa/types';
import type { Knex } from 'knex';

/**
 * A contact's location links are a reference to its own client's `client_locations` rows. Nothing
 * here ever copies an address: the editor, the REST API, CSV import and the client merge all funnel
 * through `replaceContactLocations`, which is the only place the invariants live —
 *
 *   - every location belongs to the contact's client (otherwise ContactLocationClientMismatch),
 *   - at most one link is primary,
 *   - a lone link is the primary one even when the caller did not say so.
 *
 * Deleting a location a contact uses is refused by the database (ON DELETE RESTRICT);
 * `deleteLocation` counts the links first so the operator sees "N contact(s)" instead of an FK error.
 */

export const CONTACT_LOCATION_CLIENT_MISMATCH = 'contact_location_client_mismatch';

/** A requested location does not exist under the contact's client (or the contact has no client). */
export class ContactLocationClientMismatch extends Error {
  readonly code = CONTACT_LOCATION_CLIENT_MISMATCH;
  readonly locationIds: string[];

  constructor(message: string, locationIds: string[]) {
    super(message);
    this.name = 'ContactLocationClientMismatch';
    this.locationIds = locationIds;
  }
}

export function isContactLocationClientMismatch(error: unknown): error is ContactLocationClientMismatch {
  return error instanceof ContactLocationClientMismatch
    || (error instanceof Error && (error as { code?: string }).code === CONTACT_LOCATION_CLIENT_MISMATCH);
}

/** The `client_locations` columns a link carries through to the UI and the REST response. */
export const CONTACT_LOCATION_COLUMNS = [
  'location_name',
  'address_line1',
  'address_line2',
  'address_line3',
  'city',
  'state_province',
  'postal_code',
  'country_code',
  'country_name',
  'is_active',
] as const;

type ContactLocationRow = {
  contact_name_id: string;
  location_id: string;
  is_primary: boolean;
  location_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_line3: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country_code: string | null;
  country_name: string | null;
  is_active: boolean | null;
};

export function toContactLocation(row: ContactLocationRow): IContactLocation {
  return {
    location_id: row.location_id,
    location_name: row.location_name ?? null,
    is_primary: Boolean(row.is_primary),
    is_active: row.is_active !== false,
    address_line1: row.address_line1 ?? null,
    address_line2: row.address_line2 ?? null,
    address_line3: row.address_line3 ?? null,
    city: row.city ?? null,
    state_province: row.state_province ?? null,
    postal_code: row.postal_code ?? null,
    country_code: row.country_code ?? null,
    country_name: row.country_name ?? null,
  };
}

/**
 * One batched read for a page of contacts: joined on tenant on both sides, primary link first then
 * by name so callers can take `[0]` as the primary without re-sorting.
 */
export async function getContactLocationsForContacts(
  db: Knex | Knex.Transaction,
  tenant: string,
  contactIds: readonly string[],
): Promise<Map<string, IContactLocation[]>> {
  const byContact = new Map<string, IContactLocation[]>();
  const ids = [...new Set(contactIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return byContact;

  const scoped = tenantDb(db, tenant);
  const query = scoped.table('contact_locations as cl')
    .whereIn('cl.contact_name_id', ids);
  scoped.tenantJoin(query, 'client_locations as loc', 'loc.location_id', 'cl.location_id');

  const rows = await query
    .select(
      'cl.contact_name_id',
      'cl.location_id',
      'cl.is_primary',
      ...CONTACT_LOCATION_COLUMNS.map((column) => `loc.${column}`),
    )
    .orderBy([
      { column: 'cl.contact_name_id', order: 'asc' },
      { column: 'cl.is_primary', order: 'desc' },
      { column: 'loc.location_name', order: 'asc' },
    ]) as ContactLocationRow[];

  for (const row of rows) {
    const existing = byContact.get(row.contact_name_id) ?? [];
    existing.push(toContactLocation(row));
    byContact.set(row.contact_name_id, existing);
  }
  return byContact;
}

export async function getContactLocations(
  db: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
): Promise<IContactLocation[]> {
  const byContact = await getContactLocationsForContacts(db, tenant, [contactId]);
  return byContact.get(contactId) ?? [];
}

/** Backs the "this removes N location links" confirmation before a client change. */
export async function getContactLocationCount(
  db: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
): Promise<number> {
  const row = await tenantDb(db, tenant).table('contact_locations')
    .where({ contact_name_id: contactId })
    .count<{ count: string }>('location_id as count')
    .first();
  return Number(row?.count ?? 0);
}

/** How many contacts are linked to each of the given locations (0 is omitted). */
export async function getContactCountsByLocation(
  db: Knex | Knex.Transaction,
  tenant: string,
  locationIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = [...new Set(locationIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return counts;

  const rows = await tenantDb(db, tenant).table('contact_locations')
    .whereIn('location_id', ids)
    .groupBy('location_id')
    .select('location_id')
    .count('contact_name_id as count') as Array<{ location_id: string; count: string }>;

  for (const row of rows) counts.set(row.location_id, Number(row.count));
  return counts;
}

/** The contacts linked to a location, for the client Locations card. */
export async function getContactsAtLocation(
  db: Knex | Knex.Transaction,
  tenant: string,
  locationId: string,
): Promise<Array<{ contact_name_id: string; full_name: string; is_primary: boolean }>> {
  const scoped = tenantDb(db, tenant);
  const query = scoped.table('contact_locations as cl')
    .where('cl.location_id', locationId);
  scoped.tenantJoin(query, 'contacts as c', 'c.contact_name_id', 'cl.contact_name_id');

  return await query
    .select('c.contact_name_id', 'c.full_name', 'cl.is_primary')
    .orderBy('c.full_name', 'asc') as Array<{ contact_name_id: string; full_name: string; is_primary: boolean }>;
}

function normalizeLinks(links: readonly ContactLocationInput[]): Array<{ location_id: string; is_primary: boolean }> {
  const byId = new Map<string, boolean>();
  for (const link of links) {
    if (!link?.location_id) continue;
    byId.set(link.location_id, Boolean(byId.get(link.location_id)) || Boolean(link.is_primary));
  }
  return [...byId.entries()].map(([location_id, is_primary]) => ({ location_id, is_primary }));
}

/**
 * Replace a contact's whole set of location links inside the caller's transaction.
 *
 * An empty array removes every link. The write order (drop removed rows, clear the primary flag,
 * insert new rows unflagged, then flag the primary) is what keeps the partial unique index on
 * (tenant, contact_name_id) WHERE is_primary from firing mid-replace.
 */
export async function replaceContactLocations(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string,
  links: readonly ContactLocationInput[],
  options: { createdBy?: string | null } = {},
): Promise<IContactLocation[]> {
  const db = tenantDb(trx, tenant);
  const contact = await db.table('contacts')
    .where({ contact_name_id: contactId })
    .first<{ contact_name_id: string; client_id: string | null }>();

  if (!contact) {
    throw new Error('NOT_FOUND: Contact not found');
  }

  const desired = normalizeLinks(links);

  if (desired.length === 0) {
    await db.table('contact_locations').where({ contact_name_id: contactId }).delete();
    return [];
  }

  if (desired.filter((link) => link.is_primary).length > 1) {
    throw new Error('VALIDATION_ERROR: A contact can have only one primary location');
  }

  if (!contact.client_id) {
    throw new ContactLocationClientMismatch(
      'A contact must belong to a client before it can be linked to locations',
      desired.map((link) => link.location_id),
    );
  }

  const existingLocations = await db.table('client_locations')
    .where({ client_id: contact.client_id })
    .whereIn('location_id', desired.map((link) => link.location_id))
    .pluck<string[]>('location_id');

  const known = new Set(existingLocations);
  const unknown = desired.filter((link) => !known.has(link.location_id)).map((link) => link.location_id);
  if (unknown.length > 0) {
    throw new ContactLocationClientMismatch(
      `Location ${unknown.join(', ')} does not belong to this contact's client`,
      unknown,
    );
  }

  // A single link is the primary one whether or not the caller said so.
  const primaryId = desired.length === 1
    ? desired[0].location_id
    : desired.find((link) => link.is_primary)?.location_id ?? null;

  await db.table('contact_locations')
    .where({ contact_name_id: contactId })
    .whereNotIn('location_id', desired.map((link) => link.location_id))
    .delete();

  await db.table('contact_locations')
    .where({ contact_name_id: contactId, is_primary: true })
    .update({ is_primary: false });

  const present = await db.table('contact_locations')
    .where({ contact_name_id: contactId })
    .pluck<string[]>('location_id');
  const presentSet = new Set(present);

  const inserts = desired
    .filter((link) => !presentSet.has(link.location_id))
    .map((link) => ({
      tenant,
      contact_name_id: contactId,
      location_id: link.location_id,
      is_primary: false,
      created_by: options.createdBy ?? null,
    }));

  if (inserts.length > 0) {
    await db.table('contact_locations').insert(inserts);
  }

  if (primaryId) {
    await db.table('contact_locations')
      .where({ contact_name_id: contactId, location_id: primaryId })
      .update({ is_primary: true });
  }

  return getContactLocations(trx, tenant, contactId);
}
