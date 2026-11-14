import type { Knex } from 'knex';
import { isCapabilityServed } from '@alga-psa/core/capability';
import { liveSeatArrangement, tenantDb } from '@alga-psa/db';
import type { InternalReaderIdentity } from '../commentAudience';
import { seatTechniciansOfClient } from './seatAssigneeAudience';

type Db = Knex | Knex.Transaction;

/**
 * What the ticket screen needs to know about seats for ONE ticket, resolved on the server in the
 * ticket-detail data load so the screen never fetches it itself.
 *
 * - `viewer`: `msp` for MSP staff, `client_it` for a seat technician.
 * - `arrangement`: the ticket's client has a live seat arrangement.
 * - `clientTechnicians`: the live seat technicians of the ticket's client (empty when there is no
 *   arrangement).
 */
export interface TicketSeatContext {
  viewer: 'msp' | 'client_it';
  arrangement: boolean;
  clientTechnicians: string[];
}

/**
 * Seat context of a ticket for the reader, or `null` when the ticket screen has no seat surface to
 * show: the reader is not an internal user, the `co-managed-seat` capability does not serve the
 * tenant, or (for MSP staff) no user the caller loaded is a seat technician. Every seat-aware
 * surface of the ticket screen keys off a non-null context, so without one the screen is exactly
 * what it was.
 *
 * Neutrality: a tenant without seats must pay no statement here, not even the capability's
 * participation probe (the hot-path fence measures with the decision cache off). For MSP staff the
 * signal is `users.seat_reader` on the internal users the ticket load already read for its agent
 * pickers: the marker is held `true` by a foreign key for every user a non-revoked seat assignment
 * binds, so a tenant whose active internal users all read `false` has no live seat technician, and
 * no Client IT picker group, technician filter or Client IT audience to offer. A seat technician
 * reader is identified by `seatAssigneeAudience`, which already read the seat tables.
 *
 * Cost when it proceeds: the capability decision, one indexed arrangement lookup by the ticket's
 * client, plus one technician read for MSP staff on an arrangement client. A seat technician's own
 * client is already resolved by `resolveSeatAssigneeAudience`, whose answer the caller passes in, so
 * it adds no statement.
 *
 * @param seatAssigneeAudience `resolveSeatAssigneeAudience` for this reader: non-null means a seat technician.
 * @param loadedUsers the tenant's active internal users as the caller already loaded them, each with
 *   its `seat_reader` marker. A row without the marker counts as a possible seat technician.
 */
export async function resolveTicketSeatContext(
  db: Db,
  tenant: string,
  reader: InternalReaderIdentity & { user_type?: string | null },
  clientId: string | null | undefined,
  seatAssigneeAudience: string[] | null,
  loadedUsers: ReadonlyArray<SeatMarkedUser>,
): Promise<TicketSeatContext | null> {
  if (typeof reader !== 'string' && reader.user_type && reader.user_type !== 'internal') return null;
  if (!seatAssigneeAudience && !loadedUsers.some(mayBeSeatTechnician)) return null;
  if (!(await isCapabilityServed('co-managed-seat', tenant))) return null;
  const arrangement = await liveSeatArrangement(tenantDb(db, tenant), clientId ?? null);
  if (seatAssigneeAudience) {
    // A technician's own client is the only client whose tickets they can read; their peers are its technicians.
    return { viewer: 'client_it', arrangement: Boolean(arrangement), clientTechnicians: arrangement ? seatAssigneeAudience : [] };
  }
  return {
    viewer: 'msp',
    arrangement: Boolean(arrangement),
    clientTechnicians: arrangement && clientId ? await seatTechniciansOfClient(db, tenant, clientId) : [],
  };
}

/** A user row as the ticket load reads it: the marker decides, a row without it is not trusted as staff. */
export interface SeatMarkedUser { user_id: string; seat_reader?: boolean | null }

const mayBeSeatTechnician = (row: SeatMarkedUser): boolean => row.seat_reader !== false;

/**
 * MSP staff are offered the seat technicians of the ticket's own client and no other client's:
 * on a ticket without a live arrangement, none at all. Applied to the users the ticket load already
 * read (with their `users.seat_reader` marker), so it costs no statement and reads no co-managed
 * table. Unchanged while there is no seat context (no seat technician exists) or for a technician's
 * own picker, which the seat audience already restricts.
 */
export function keepThisClientsSeatTechnicians<Row extends SeatMarkedUser>(
  rows: Row[],
  seatTicket: { viewer: 'msp' | 'client_it'; clientTechnicians: string[] } | null,
): Row[] {
  if (!seatTicket || seatTicket.viewer !== 'msp') return rows;
  const theirs = new Set(seatTicket.clientTechnicians);
  return rows.filter((row) => row.seat_reader === false || theirs.has(row.user_id));
}
