import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { InternalReaderIdentity } from '../commentAudience';
import { resolveSeatAssigneeAudience } from './seatAssigneeAudience';
import { resolveTicketSeatContext, type TicketSeatContext } from './ticketSeatContext';

type Db = Knex | Knex.Transaction;

/**
 * "What time can this reader see on this ticket" (S28 / F069), with one meaning for every surface that lists
 * or totals a ticket's time entries (the Time logged tile and the Timeline).
 *
 * A seat technician (`viewer === 'client_it'`) on a ticket whose client has a live arrangement sees
 * operational time only. The MSP's commercial time reaches them as a total on the Effort card (and only when
 * the arrangement setting allows it, see `resolveSeatEffortSummary`), never as an entry, a note, a name or a
 * count. Everyone else, and every ticket without a live arrangement, is unrestricted.
 */
export const seatViewerSeesOperationalTimeOnly = (seatTicket: Pick<TicketSeatContext, 'viewer' | 'arrangement'> | null): boolean =>
  seatTicket?.viewer === 'client_it' && seatTicket.arrangement;

/**
 * Server-side resolver for the surfaces that do not load the ticket's seat context themselves.
 *
 * Hot-path cost: a reader whose loaded user row carries `seat_reader === false` (MSP staff in a tenant
 * with the marker) adds NO statement. Otherwise one indexed lookup of `co_managed_seat_assignments` by user
 * id; only a seat technician goes on to read the ticket's client, the capability decision and the
 * arrangement (the same statements `resolveTicketSeatContext` costs the ticket load).
 */
export async function resolveSeatViewerOperationalOnly(
  db: Db,
  tenant: string,
  reader: InternalReaderIdentity & { user_type?: string | null },
  ticketId: string,
): Promise<boolean> {
  if (typeof reader !== 'string' && reader.user_type && reader.user_type !== 'internal') return false;
  const audience = await resolveSeatAssigneeAudience(db, tenant, reader);
  if (!audience) return false;
  const ticket = await tenantDb(db, tenant).table('tickets').where({ ticket_id: ticketId }).first('client_id');
  const seatTicket = await resolveTicketSeatContext(db, tenant, reader, ticket?.client_id ?? null, audience, []);
  return seatViewerSeesOperationalTimeOnly(seatTicket);
}
