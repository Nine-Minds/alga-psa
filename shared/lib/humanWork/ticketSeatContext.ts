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
 * Seat context of a ticket for the reader, or `null` when the `co-managed-seat` capability does
 * not serve the tenant (cached per tenant, no statement) or the reader is not an internal user.
 * Every seat-aware surface of the ticket screen keys off a non-null context, so with the capability
 * closed the screen is exactly what it was.
 *
 * Cost when served: one indexed arrangement lookup by the ticket's client, plus one technician read
 * for MSP staff on an arrangement client. A seat technician's own client is already resolved by
 * `seatAssigneeAudience` (`resolveSeatAssigneeAudience`), whose answer the caller passes in, so it
 * adds no statement.
 *
 * @param seatAssigneeAudience `resolveSeatAssigneeAudience` for this reader: non-null means a seat technician.
 */
export async function resolveTicketSeatContext(
  db: Db,
  tenant: string,
  reader: InternalReaderIdentity & { user_type?: string | null },
  clientId: string | null | undefined,
  seatAssigneeAudience: string[] | null,
): Promise<TicketSeatContext | null> {
  if (typeof reader !== 'string' && reader.user_type && reader.user_type !== 'internal') return null;
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

/**
 * MSP staff are offered the seat technicians of the ticket's own client and no other client's:
 * on a ticket without a live arrangement, none at all. `users.seat_reader` is true for every user a
 * seat assignment binds, so the filter reads no co-managed table. No restriction while the seat
 * capability does not serve the tenant (no seat technician exists) or for a technician's own picker.
 */
export function restrictToThisClientsSeatTechnicians<Q extends { where: (...args: any[]) => any }>(
  query: Q,
  seatTicket: { viewer: 'msp' | 'client_it'; clientTechnicians: string[] } | null,
): Q {
  if (!seatTicket || seatTicket.viewer !== 'msp') return query;
  return query.where((own: any) => {
    own.where('seat_reader', false);
    if (seatTicket.clientTechnicians.length > 0) own.orWhereIn('user_id', seatTicket.clientTechnicians);
  }) as Q;
}
