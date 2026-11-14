'use server';

import { withAuth } from '@alga-psa/auth';
import { RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import { resolveTicketResponsibility, TicketResponsibilityError, type TicketResponsibilityState } from '../lib/ticketResponsibility';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';

/** Each refusal of a handoff, as the user is told it. The key is translated by the caller's locale. */
const HANDOFF_REFUSALS: Record<string, { message: string; key: string }> = {
  INVALID_HANDOFF: { message: 'Write a shared note for client IT before handing this ticket over.', key: 'features/tickets:errors.seatHandoff.invalidHandoff' },
  TICKET_NOT_FOUND: { message: 'This ticket is no longer available.', key: 'features/tickets:errors.seatHandoff.ticketNotFound' },
  NO_SEAT_ARRANGEMENT: { message: "This ticket's client no longer has a co-managed seat arrangement.", key: 'features/tickets:errors.seatHandoff.noArrangement' },
  OPERATION_CONFLICT: { message: 'This handoff was started with different details. Try again.', key: 'features/tickets:errors.seatHandoff.operationConflict' },
  HANDOFF_CHANGED: { message: 'This ticket was handed off or reassigned. Refresh the ticket before trying again.', key: 'features/tickets:errors.seatHandoff.changed' },
  ALREADY_RESPONSIBLE: { message: 'Client IT is already responsible for this ticket. Refresh the ticket to see its current state.', key: 'features/tickets:errors.seatHandoff.alreadyResponsible' },
  ACTOR_NOT_ALLOWED: { message: 'You cannot hand this ticket to client IT.', key: 'features/tickets:errors.seatHandoff.actorNotAllowed' },
  BOARD_OUT_OF_SCOPE: { message: "This ticket's board is not shared with client IT, so it cannot be handed over.", key: 'features/tickets:errors.seatHandoff.boardOutOfScope' },
  TECHNICIAN_NOT_AVAILABLE: { message: 'The selected technician is no longer available for this client. Choose another or leave it unassigned.', key: 'features/tickets:errors.seatHandoff.technicianNotAvailable' },
};

export interface HandTicketToClientItInput {
  ticketId: string;
  /** From the ticket screen's chip: the revision the user saw. */
  expectedRevision: number;
  /** A shared note, visible to client IT. Required. */
  note: string;
  technicianUserId?: string | null;
  /** Idempotency key, fixed for one submission so a retry returns the original receipt. */
  operationId: string;
}

/**
 * MSP staff hand a ticket of a seat-arrangement client to client IT. Requires ticket update
 * permission and read access to the ticket; the provider's command refuses everyone who is not MSP
 * staff, a board the arrangement does not share, and a stale revision. Returns the ticket's
 * responsibility as it now stands, so the chip refreshes from the same answer.
 */
export const handTicketToClientIt = withAuth(async (
  user,
  { tenant },
  input: HandTicketToClientItInput,
): Promise<{ state: TicketResponsibilityState } | TicketActionError> => {
  if (user.user_type !== 'internal') {
    return permissionError('Permission denied: operation not available in client portal');
  }
  const { knex: db } = await createTenantKnex();
  try {
    const subject = await withTransaction(db, async (trx) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot update ticket');
      }
      return resolveAuthorizationSubject(trx, { tenant, user, requestCache: new RequestLocalAuthorizationCache() });
    });
    const provider = await resolveTicketResponsibility({ tenant, subject });
    if (!provider) return actionError('Handing tickets to client IT is not available.', 'features/tickets:errors.seatHandoff.unavailable');

    await provider.handToClientIt(db, {
      tenant, ticketId: input.ticketId, actorUserId: user.user_id, operationId: input.operationId,
      expectedRevision: input.expectedRevision, note: input.note, technicianUserId: input.technicianUserId ?? null,
    });
    const state = await withTransaction(db, (trx) => provider.load(trx, tenant, input.ticketId));
    return state
      ? { state }
      : actionError(HANDOFF_REFUSALS.NO_SEAT_ARRANGEMENT.message, HANDOFF_REFUSALS.NO_SEAT_ARRANGEMENT.key);
  } catch (error) {
    if (error instanceof TicketResponsibilityError) {
      const refusal = HANDOFF_REFUSALS[error.code];
      if (refusal) return actionError(refusal.message, refusal.key);
    }
    const expected = ticketActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
