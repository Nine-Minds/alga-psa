import type { Knex } from 'knex';
import { projectedPeopleForCaller } from '@alga-psa/user-composition/lib/seatPeople';

type WatchEntry = Record<string, unknown>;

/**
 * A ticket row as the CALLER may read its watch list.
 *
 * `attributes.watch_list` stores each recipient's full email address, which notification delivery needs and which
 * stays in the database untouched. A response is not delivery: a restricted caller (a co-managed seat technician)
 * is released only the people its projection lists, and of those only the fields the projection releases. The
 * board's default recipients are MSP staff who need not be on any ticket the technician can see, so they are not
 * released at all: not their email, and not their name. Everyone else gets the row exactly as it is, at no
 * statement beyond the projection probe.
 */
export async function projectTicketWatchListForCaller<T extends { attributes?: unknown }>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: { user_id?: string; user_type?: string },
  ticket: T,
): Promise<T> {
  const attributes = ticket.attributes;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return ticket;
  const watchList = (attributes as Record<string, unknown>).watch_list;
  if (!Array.isArray(watchList)) return ticket;

  const people = await projectedPeopleForCaller(trx, tenant, user, { kinds: ['msp_staff', 'client_technician', 'contact'] });
  if (people === null) return ticket;

  const byUser = new Map(people.flatMap((person) => (person.userId ? [[person.userId, person] as const] : [])));
  const byContact = new Map(people.flatMap((person) => (person.contactId ? [[person.contactId, person] as const] : [])));
  const released = (watchList as WatchEntry[]).flatMap((entry) => {
    const entityId = typeof entry.entity_id === 'string' ? entry.entity_id : null;
    const person = entityId ? (entry.entity_type === 'contact' ? byContact : byUser).get(entityId) : undefined;
    if (!person) return [];
    const { email: _stored, ...rest } = entry;
    return [person.email ? { ...rest, email: person.email } : rest];
  });

  const next: Record<string, unknown> = { ...(attributes as Record<string, unknown>) };
  if (released.length > 0) next.watch_list = released;
  else delete next.watch_list;
  return { ...ticket, attributes: next };
}
