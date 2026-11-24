import type { Knex } from 'knex';
import { projectedPeopleForCaller } from '@alga-psa/user-composition/lib/seatPeople';
import type { ProjectedPerson } from '@alga-psa/authorization/subject/peopleProjection';

type WatchEntry = { entity_id?: unknown; entity_type?: unknown; email?: unknown };

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
  if (watchListOf(ticket) === null) return ticket;
  return projectTicketWatchList(ticket, await projectedPeopleForCaller(trx, tenant, user, { kinds: WATCHER_KINDS }));
}

/** The people kinds a watch list can name. Pass these when resolving `people` for `projectTicketWatchList`. */
export const WATCHER_KINDS: Array<'msp_staff' | 'client_technician' | 'contact'> = ['msp_staff', 'client_technician', 'contact'];

/** The stored watch list of a ticket row, or null when it has none (nothing to project, nothing to resolve). */
export function watchListOf(ticket: { attributes?: unknown }): WatchEntry[] | null {
  const attributes = ticket.attributes;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null;
  const watchList = (attributes as Record<string, unknown>).watch_list;
  return Array.isArray(watchList) && watchList.length > 0 ? (watchList as WatchEntry[]) : null;
}

/**
 * `projectTicketWatchListForCaller` for a caller whose people projection is already resolved (`null`: nothing
 * restricts the caller). The ticket screen resolves it from the subject it already holds, at no statement for a
 * subject no projector claims.
 */
export function projectTicketWatchList<T extends { attributes?: unknown }>(ticket: T, people: readonly ProjectedPerson[] | null): T {
  const watchList = watchListOf(ticket);
  if (watchList === null || people === null) return ticket;
  const released = releaseWatchEntries(watchList, people);
  const next: Record<string, unknown> = { ...(ticket.attributes as Record<string, unknown>) };
  if (released.length > 0) next.watch_list = released;
  else delete next.watch_list;
  return { ...ticket, attributes: next };
}

/**
 * Watch-list entries (the stored mirror, or `TicketWatcherService`'s watchers) as the CALLER may read them: the
 * same rule as `projectTicketWatchListForCaller`, for every response that lists a ticket's watchers (the ticket
 * screen, and each watcher add/remove/toggle answer). The same array comes back for a caller nothing restricts.
 */
export async function projectWatchEntriesForCaller<E extends WatchEntry>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: { user_id?: string; user_type?: string },
  entries: readonly E[],
): Promise<E[]> {
  if (entries.length === 0) return entries as E[];
  const people = await projectedPeopleForCaller(trx, tenant, user, { kinds: WATCHER_KINDS });
  return people === null ? (entries as E[]) : releaseWatchEntries(entries, people);
}

/** Only the listed people, and of each only the email the projection releases. */
function releaseWatchEntries<E extends WatchEntry>(entries: readonly E[], people: readonly ProjectedPerson[]): E[] {
  const byUser = new Map(people.flatMap((person) => (person.userId ? [[person.userId, person] as const] : [])));
  const byContact = new Map(people.flatMap((person) => (person.contactId ? [[person.contactId, person] as const] : [])));
  return entries.flatMap((entry) => {
    const entityId = typeof entry.entity_id === 'string' ? entry.entity_id : null;
    const person = entityId ? (entry.entity_type === 'contact' ? byContact : byUser).get(entityId) : undefined;
    if (!person) return [];
    const { email: _stored, ...rest } = entry;
    return [(person.email ? { ...rest, email: person.email } : rest) as E];
  });
}
