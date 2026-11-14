import type { Knex } from 'knex';
import { recordTicketAssigneeChange, tenantDb } from '@alga-psa/db';
import { releaseCoManagedSeatAllocation } from '@alga-psa/licensing';
import { CoManagedSeatArrangementError } from './seatArrangement';
import { returnCoManagedSeatArrangementTicketsToMsp } from './seatTicketHandoff';

/**
 * Ending a seat arrangement: one transaction that stops everything the arrangement gave its
 * technicians, and gives the seats back to the pool.
 *
 * In this order, all in the caller's single transaction:
 *
 *   1. responsibility: every ticket client IT is responsible for goes back to the MSP as an
 *      ordinary recorded handoff (`returnCoManagedSeatArrangementTicketsToMsp`), and a technician
 *      still assigned to an MSP-held ticket is cleared. Shared notes are untouched: they are
 *      comments of the ticket, and an MSP user reads them through the ordinary audience rule.
 *   2. the allocation is released through the pool's own release (`releaseCoManagedSeatAllocation`)
 *   3. the technicians are deactivated, unaccepted invitations are withdrawn, and the arrangement is
 *      marked ended.
 *
 * The assignments are left as they are. An assignment on an ended arrangement is the state the
 * comment read path already defines as "sees nothing" (`resolveCommentAudienceReader` answers null,
 * so a technician is never promoted to MSP staff); revoking it would turn the deactivated user into
 * staff for any session that outlives the deactivation. Seat admission refuses to reactivate them
 * (`ARRANGEMENT_ENDED`) and the write gate refuses their writes.
 *
 * Replaying it changes nothing and fails nothing, with no check of its own for that: the release is
 * update-if-not-released, the responsibility return selects only tickets still with client IT and
 * records under an operation id derived from the arrangement and ticket, and every other write is
 * conditional on the state it moves from. `ended` in the result says whether THIS call did the ending.
 *
 * Takes the sponsor's entitlement row first, as every allocation writer does, then ticket rows, then
 * the arrangement (the order the handoff commands use: ticket before arrangement).
 *
 * Internal command with no entry point of its own; a caller must authorize sponsor administration.
 */

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The shared note each returned ticket carries. Stored data of the ticket's history, in the sponsor's record. */
export const CO_MANAGED_SEAT_ARRANGEMENT_ENDED_NOTE =
  'This co-managed seat arrangement ended. Responsibility for this ticket is back with the MSP.';

export interface EndCoManagedSeatArrangementInput {
  sponsorTenant: string;
  arrangementId: string;
  /** The sponsor administrator ending the arrangement. */
  actorUserId: string;
}

export interface CoManagedSeatArrangementEndResult {
  arrangementId: string;
  /** True when this call ended the arrangement; false on a replay. */
  ended: boolean;
  /** Seats this call returned to the pool; 0 on a replay. */
  releasedSeats: number;
  /** Technician accounts this call deactivated. */
  deactivatedTechnicians: number;
  /** Tickets this call handed back to the MSP, plus technician assignees it cleared. */
  ticketsReturned: number;
}

export async function endCoManagedSeatArrangement(
  db: Knex,
  input: EndCoManagedSeatArrangementInput,
): Promise<CoManagedSeatArrangementEndResult> {
  if (![input.sponsorTenant, input.arrangementId, input.actorUserId].every((id) => typeof id === 'string' && uuid.test(id))) {
    throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');
  }
  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    // The pool lock, before any other row.
    await sponsor.table('co_managed_entitlements').forUpdate().first('tenant');
    const arrangement = await sponsor.table('co_managed_seat_arrangements')
      .where('arrangement_id', input.arrangementId).first('allocation_id', 'client_id');
    if (!arrangement) throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');

    const assignments: Array<{ assignment_id: string; state: string; user_id: string | null; invitation_id: string | null }> =
      await sponsor.table('co_managed_seat_assignments').where('arrangement_id', input.arrangementId)
        .select('assignment_id', 'state', 'user_id', 'invitation_id');
    const technicianIds = assignments.flatMap((assignment) => assignment.user_id ? [assignment.user_id] : []);

    // 1. Responsibility, while the arrangement is still live and its technicians still seated.
    const returned = await returnCoManagedSeatArrangementTicketsToMsp(trx, {
      sponsorTenant: input.sponsorTenant, arrangementId: input.arrangementId, actorUserId: input.actorUserId,
      note: CO_MANAGED_SEAT_ARRANGEMENT_ENDED_NOTE,
    });
    let ticketsReturned = returned.length;
    if (technicianIds.length) {
      const stillAssigned: Array<{ ticket_id: string }> = await sponsor.table('tickets')
        .where('client_id', arrangement.client_id).whereIn('assigned_to', technicianIds).select('ticket_id');
      for (const { ticket_id: ticketId } of stillAssigned) {
        // Locks the ticket and moves its work revision on, as every assignee writer does.
        await recordTicketAssigneeChange(trx, input.sponsorTenant, ticketId);
        // write-admission: exempt — seat arrangement end clears the assignee under the ticket lock it just took
        await sponsor.table('tickets').where('ticket_id', ticketId)
          .update({ assigned_to: null, updated_by: input.actorUserId, updated_at: new Date() });
        ticketsReturned += 1;
      }
    }

    // 2. The allocation, once: the release's own state is what makes a replay a no-op.
    const release = await releaseCoManagedSeatAllocation(trx, input.sponsorTenant, { allocationId: arrangement.allocation_id });

    // 3. Technicians and the arrangement.
    const live = assignments.filter((assignment) => assignment.state !== 'revoked');
    // An invitation that was never accepted would otherwise stay open, and count against the MSP's own licence.
    const invitationIds = live.flatMap((assignment) => assignment.state === 'invited' && assignment.invitation_id ? [assignment.invitation_id] : []);
    if (invitationIds.length) {
      // write-admission: exempt — seat invitation, stopped by its owning command under the pool lock
      await sponsor.table('user_invitations').whereIn('invitation_id', invitationIds).whereNull('used_at')
        .update({ expires_at: trx.fn.now() });
    }
    const activeIds = live.flatMap((assignment) => assignment.state === 'active' && assignment.user_id ? [assignment.user_id] : []);
    const deactivated = activeIds.length
      ? await sponsor.table('users').whereIn('user_id', activeIds).where('is_inactive', false)
        .update({ is_inactive: true, updated_at: trx.fn.now() })
      : 0;
    // write-admission: exempt — seat arrangement lifecycle state, written by its owning command under the pool lock
    const ended = await sponsor.table('co_managed_seat_arrangements')
      .where('arrangement_id', input.arrangementId).whereNot('state', 'ended')
      .update({ state: 'ended', ended_at: trx.fn.now(), revision: trx.raw('revision + 1'), updated_at: trx.fn.now() });

    return {
      arrangementId: input.arrangementId, ended: Number(ended) > 0, releasedSeats: release.seats,
      deactivatedTechnicians: Number(deactivated), ticketsReturned,
    };
  });
}

/** What ending an arrangement would do now: the effects the confirmation lists. Reads only. */
export interface CoManagedSeatArrangementEndPreview {
  arrangementId: string;
  clientName: string | null;
  state: 'active' | 'ended';
  /** Active technicians who would be deactivated. */
  technicians: number;
  /** Invitations not yet accepted that would be withdrawn. */
  pendingInvitations: number;
  /** Tickets client IT is responsible for, which would go back to the MSP. */
  ticketsWithClientIt: number;
  /** Seats the allocation would give back to the pool. */
  seatsToRelease: number;
}

export async function previewCoManagedSeatArrangementEnd(
  db: Knex | Knex.Transaction,
  input: { sponsorTenant: string; arrangementId: string },
): Promise<CoManagedSeatArrangementEndPreview> {
  if (![input.sponsorTenant, input.arrangementId].every((id) => typeof id === 'string' && uuid.test(id))) {
    throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');
  }
  const sponsor = tenantDb(db, input.sponsorTenant);
  const arrangement = await sponsor.table('co_managed_seat_arrangements')
    .where('arrangement_id', input.arrangementId).first('client_id', 'allocation_id', 'state');
  if (!arrangement) throw new CoManagedSeatArrangementError('ARRANGEMENT_NOT_FOUND');
  const count = async (query: Knex.QueryBuilder) => Number((await query.count('* as count').first())?.count ?? 0);
  const live = () => sponsor.table('co_managed_seat_assignments').where('arrangement_id', input.arrangementId);
  const client = await sponsor.table('clients').where('client_id', arrangement.client_id).first('client_name');
  const allocation = await sponsor.table('co_managed_allocations')
    .where({ allocation_id: arrangement.allocation_id, allocation_kind: 'seat' }).whereNot('state', 'released').first('seats');
  return {
    arrangementId: input.arrangementId,
    clientName: client?.client_name ?? null,
    state: arrangement.state,
    technicians: await count(live().where('state', 'active')),
    pendingInvitations: await count(live().where('state', 'invited')),
    ticketsWithClientIt: await count(sponsor.table('co_managed_seat_ticket_work')
      .where({ arrangement_id: input.arrangementId, responsibility: 'client_it' })),
    seatsToRelease: Number(allocation?.seats ?? 0),
  };
}
