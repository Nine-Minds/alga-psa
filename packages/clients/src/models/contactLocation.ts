import { tenantDb } from '@alga-psa/db';
import type { ContactLocationInput, IContactLocation } from '@alga-psa/types';
import type { Knex } from 'knex';
import { getContactLocations } from '@alga-psa/shared/models/contactLocation';

// The reads live in shared/models/contactLocation.ts so the ticket paths and the pickers can use
// them without depending on this package; the write, with its invariants, lives here.
export {
  CONTACT_LOCATION_COLUMNS,
  getContactCountsByLocation,
  getContactLocationCount,
  getContactLocations,
  getContactLocationsForContacts,
  getContactsAtLocation,
  toContactLocation,
} from '@alga-psa/shared/models/contactLocation';
export type { ContactLocationRow } from '@alga-psa/shared/models/contactLocation';

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
