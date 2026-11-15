/**
 * The MSP ticket list's responsibility column and filter for seat arrangements.
 *
 * Offered to MSP staff (any reader the seat resolver does not govern) while the seat shape is
 * released for the tenant (`release-v2-0-feature` on, `co-managed-seat` served). A seat technician is
 * offered named views instead (./seatTicketListViews). Everyone else resolves to "not offered"
 * from facts already loaded with the subject and the tenant's cached release verdict: no statement.
 *
 * The value is read for the page's tickets only, in one statement, from the ticket query schema's
 * `seat_responsibility` predicate, the same definition the filter compiles through. A ticket whose
 * client has no live arrangement matches neither value and has none.
 *
 * Registration is a side effect of importing this module; `./capability` imports it.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { compilePredicateFragment } from '@alga-psa/predicates/sql';
import { createTicketQuerySchema } from '@alga-psa/shared/lib/ticketQuery/ticketQuerySchema';
import {
  registerTicketResponsibilityProvider,
  TicketResponsibilityError,
  type TicketResponsibility,
  type TicketResponsibilityProvider,
} from '@alga-psa/tickets/lib/ticketResponsibility';
import { coManagedSeatAuthority } from './seatAuthority';
import { coManagedSeatReleased } from './seatRelease';
import { CoManagedSeatHandoffError, handCoManagedSeatTicketToClientIt, readCoManagedSeatTicketWork } from './seatTicketHandoff';

export const CO_MANAGED_SEAT_LIST_RESPONSIBILITY_PROVIDER_ID = 'co-managed-seat';

const RESPONSIBILITIES: readonly TicketResponsibility[] = ['client_it', 'msp'];

export const coManagedSeatListResponsibilityProvider: TicketResponsibilityProvider = {
  async offered({ tenant, subject }) {
    if (coManagedSeatAuthority(subject)) return false;
    return coManagedSeatReleased(tenant);
  },

  async read(trx: Knex.Transaction, tenant: string, ticketIds: readonly string[]) {
    const result = new Map<string, TicketResponsibility>();
    if (ticketIds.length === 0) return result;
    const schema = createTicketQuerySchema();
    const [clientIt, msp] = RESPONSIBILITIES.map((value) =>
      compilePredicateFragment(schema, { join: 'and', clauses: [{ path: 'seat_responsibility', operator: 'equals', value }] }, { rootAlias: 't' }));
    const rows: Array<{ ticket_id: string; responsibility: TicketResponsibility | null }> = (await trx.raw(
      `SELECT t.ticket_id,
              CASE WHEN ${clientIt.sql} THEN 'client_it' WHEN ${msp.sql} THEN 'msp' END AS responsibility
         FROM tickets AS t
        WHERE t.tenant = ? AND t.ticket_id IN (${ticketIds.map(() => '?').join(', ')})`,
      [...clientIt.bindings, ...msp.bindings, tenant, ...ticketIds] as Knex.RawBinding[],
    )).rows;
    for (const row of rows) if (row.responsibility) result.set(row.ticket_id, row.responsibility);
    return result;
  },

  async load(trx, tenant, ticketId) {
    const work = await readCoManagedSeatTicketWork(trx, { sponsorTenant: tenant, ticketId });
    if (!work) return null;
    return { responsibility: work.responsibility, revision: work.revision, technicians: await seatTechnicians(trx, tenant, work.arrangementId) };
  },

  async handToClientIt(db, input) {
    try {
      const receipt = await handCoManagedSeatTicketToClientIt(db, {
        sponsorTenant: input.tenant, ticketId: input.ticketId, actorUserId: input.actorUserId, operationId: input.operationId,
        expectedRevision: input.expectedRevision, note: input.note, technicianUserId: input.technicianUserId ?? null,
      });
      return { responsibility: receipt.to, revision: receipt.revision, technicians: [] };
    } catch (error) {
      if (error instanceof CoManagedSeatHandoffError) throw new TicketResponsibilityError(error.code);
      throw error;
    }
  },
};

/** The arrangement's active seat technicians, by display name, for the ticket screen's picker. */
async function seatTechnicians(trx: Knex.Transaction, tenant: string, arrangementId: string) {
  const sponsor = tenantDb(trx, tenant);
  const query = sponsor.table('co_managed_seat_assignments as sa').where({ 'sa.arrangement_id': arrangementId, 'sa.state': 'active' });
  sponsor.tenantJoin(query, 'users as u', 'sa.user_id', 'u.user_id');
  const rows: Array<{ user_id: string; first_name: string | null; last_name: string | null; username: string | null }> = await query
    .where({ 'u.user_type': 'internal', 'u.is_inactive': false })
    .select('u.user_id', 'u.first_name', 'u.last_name', 'u.username')
    .orderBy(['u.first_name', 'u.last_name']);
  return rows.map((row) => ({
    user_id: row.user_id,
    display_name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || '',
  }));
}

/** Idempotent: registering again replaces the earlier registration. */
export function registerCoManagedSeatListResponsibility(): void {
  registerTicketResponsibilityProvider(CO_MANAGED_SEAT_LIST_RESPONSIBILITY_PROVIDER_ID, coManagedSeatListResponsibilityProvider);
}

registerCoManagedSeatListResponsibility();
