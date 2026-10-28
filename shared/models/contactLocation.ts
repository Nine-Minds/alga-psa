import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Where a ticket for this person should land when nothing more specific was asked for.
 *
 * Precedence: a remote worker gets no location at all (never the client's head office), then the
 * primary link, then the only link, then the client's default active location, then nothing. Only
 * active locations take part: a deactivated site is not somewhere to send an engineer.
 *
 * This is the single rule behind MSP quick add, ticket detail, inbound email, the client portal,
 * REST v1 and mobile — `TicketModel.createTicket` calls it whenever `location_id` is `undefined`.
 * `null` from a caller means "explicitly none" and never reaches here.
 */
export async function resolveContactLocationId(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
): Promise<string | null> {
  const db = tenantDb(trx, tenant);
  const contact = await db.table('contacts')
    .where({ contact_name_id: contactId })
    .first<{ client_id: string | null; work_arrangement: string | null }>(['client_id', 'work_arrangement']);

  if (!contact) return null;
  if (contact.work_arrangement === 'remote') return null;

  const linkQuery = db.table('contact_locations as cl')
    .where('cl.contact_name_id', contactId);
  db.tenantJoin(linkQuery, 'client_locations as loc', 'loc.location_id', 'cl.location_id');
  const links = await linkQuery
    .where('loc.is_active', true)
    .select('cl.location_id', 'cl.is_primary')
    .orderBy([{ column: 'cl.is_primary', order: 'desc' }, { column: 'loc.location_name', order: 'asc' }]) as
    Array<{ location_id: string; is_primary: boolean }>;

  const primary = links.find((link) => link.is_primary);
  if (primary) return primary.location_id;
  if (links.length === 1) return links[0].location_id;

  // Several active links and none primary (only reachable by a direct write — the editor and
  // replaceContactLocations always leave a primary): nothing here can choose between them, so fall
  // through to the client default rather than pick one at random.
  if (!contact.client_id) return null;
  const fallback = await db.table('client_locations')
    .where({ client_id: contact.client_id, is_default: true, is_active: true })
    .first<{ location_id: string }>(['location_id']);

  return fallback?.location_id ?? null;
}
