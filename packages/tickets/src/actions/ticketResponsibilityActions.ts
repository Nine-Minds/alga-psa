'use server';

import { withAuth, localizeActionError } from '@alga-psa/auth';
import { RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';
import type { AuthorizationSubject } from '@alga-psa/authorization/kernel/contracts';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { actionError, getActionErrorMessageKey, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  resolveTicketHandoff,
  resolveTicketResponsibility,
  ticketResponsibilityRefusalCode,
  type TicketHandoffDirection,
  type TicketResponsibilityProvider,
  type TicketResponsibilityState,
} from '../lib/ticketResponsibility';
import { bulkHandoffOperationId } from '../lib/bulkHandoffOperationId';
import {
  MAX_BULK_HANDOFF_TICKETS,
  runBulkHandoff,
  type BulkHandoffItem,
  type BulkHandoffTicketResult,
} from '../lib/bulkHandoff';
import { assertTicketReadable } from './optimizedTicketActions';
import { ticketActionErrorFrom, type TicketActionError } from './ticketActionErrors';

type Refusal = { message: string; key: string };

/** Each refusal of a handoff to client IT, as the user is told it. The key is translated by the caller's locale. */
const HANDOFF_REFUSALS: Record<string, Refusal> = {
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

/** The refusals whose wording names the direction: a handoff to the MSP overrides these of the client IT table. */
const HANDOFF_TO_MSP_REFUSALS: Record<string, Refusal> = {
  ...HANDOFF_REFUSALS,
  INVALID_HANDOFF: { message: 'Write a shared note for the MSP before handing this ticket over.', key: 'features/tickets:errors.seatHandoff.invalidHandoffToMsp' },
  ALREADY_RESPONSIBLE: { message: 'The MSP is already responsible for this ticket. Refresh the ticket to see its current state.', key: 'features/tickets:errors.seatHandoff.alreadyResponsibleMsp' },
  ACTOR_NOT_ALLOWED: { message: 'You cannot hand this ticket to the MSP.', key: 'features/tickets:errors.seatHandoff.actorNotAllowedMsp' },
};

/** What a ticket the caller cannot read looks like: the same as one that does not exist, so its existence is not revealed. */
const NOT_AVAILABLE: Refusal = HANDOFF_REFUSALS.TICKET_NOT_FOUND;
const UNEXPECTED: Refusal = {
  message: 'This ticket could not be handed over. Refresh the list to see where it stands, then try again.',
  key: 'features/tickets:errors.seatHandoff.unexpected',
};

/** Everything that differs between the two handoffs. */
interface HandoffDirectionDefinition {
  refusals: Record<string, Refusal>;
  unavailable: Refusal;
  /** The provider that runs this direction for the caller, or null when the caller is not offered it. */
  resolve(input: { tenant: string; subject: Pick<AuthorizationSubject, 'resolverFacts'> }): Promise<TicketResponsibilityProvider | null>;
  run(
    provider: TicketResponsibilityProvider, db: Knex,
    input: { tenant: string; ticketId: string; actorUserId: string; operationId: string; expectedRevision: number; note: string; technicianUserId: string | null },
  ): Promise<TicketResponsibilityState>;
}

const DIRECTIONS: Record<TicketHandoffDirection, HandoffDirectionDefinition> = {
  client_it: {
    refusals: HANDOFF_REFUSALS,
    unavailable: { message: 'Handing tickets to client IT is not available.', key: 'features/tickets:errors.seatHandoff.unavailable' },
    resolve: (input) => resolveTicketResponsibility(input),
    run: (provider, db, input) => provider.handToClientIt(db, input),
  },
  msp: {
    refusals: HANDOFF_TO_MSP_REFUSALS,
    unavailable: { message: 'Handing tickets to the MSP is not available.', key: 'features/tickets:errors.seatHandoff.unavailableMsp' },
    async resolve(input) {
      const handoff = await resolveTicketHandoff(input);
      return handoff?.direction === 'msp' ? handoff.provider : null;
    },
    // Naming a technician is not part of this direction; the command drops it, and so does this.
    run: (provider, db, { technicianUserId: _dropped, ...input }) => provider.handToMsp(db, input),
  },
};

/**
 * The caller, authorized once for a run of handoffs: an internal user with ticket update permission, and the
 * authorization subject the provider decides from. The provider itself is resolved on first use, after the
 * record-level read check, so a caller who cannot read a ticket learns nothing about handoff availability from it.
 */
interface HandoffSession {
  user: IUserWithRoles;
  tenant: string;
  db: Knex;
  direction: TicketHandoffDirection;
  subject: AuthorizationSubject;
  provider(): Promise<TicketResponsibilityProvider | null>;
}

async function openHandoffSession(
  user: IUserWithRoles, tenant: string, direction: TicketHandoffDirection,
): Promise<HandoffSession | TicketActionError> {
  if (user.user_type !== 'internal') {
    return permissionError('Permission denied: operation not available in client portal');
  }
  const { knex: db } = await createTenantKnex();
  const subject = await withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot update ticket');
    }
    return resolveAuthorizationSubject(trx, { tenant, user, requestCache: new RequestLocalAuthorizationCache() });
  });
  let resolved: Promise<TicketResponsibilityProvider | null> | undefined;
  return {
    user, tenant, db, direction, subject,
    provider: () => (resolved ??= DIRECTIONS[direction].resolve({ tenant, subject })),
  };
}

interface HandoffRequest {
  ticketId: string;
  expectedRevision: number;
  note: string;
  technicianUserId?: string | null;
  operationId: string;
}

/**
 * One ticket's handoff: the single checks, whoever asks (the ticket screen or a bulk run). Record-level
 * authorization as on the ticket screen (`assertTicketReadable`: a ticket the caller cannot read is neither handed
 * off nor confirmed to exist), the provider, the command, and the refusal mapping. Returns the ticket's
 * responsibility as it now stands, or the refusal as the user is to be told it. Unexpected errors propagate.
 */
async function handOffTicket(
  session: HandoffSession, request: HandoffRequest, options: { fullState: boolean },
): Promise<{ state: TicketResponsibilityState } | TicketActionError> {
  const direction = DIRECTIONS[session.direction];
  try {
    const readable = await assertTicketReadable(request.ticketId);
    if (readable !== true) return readable;

    const provider = await session.provider();
    if (!provider) return actionError(direction.unavailable.message, direction.unavailable.key);

    const handedOver = await direction.run(provider, session.db, {
      tenant: session.tenant, ticketId: request.ticketId, actorUserId: session.user.user_id, operationId: request.operationId,
      expectedRevision: request.expectedRevision, note: request.note, technicianUserId: request.technicianUserId ?? null,
    });
    if (!options.fullState) return { state: handedOver };
    const state = await withTransaction(session.db, (trx) => provider.load(trx, session.tenant, request.ticketId));
    return state
      ? { state }
      : actionError(HANDOFF_REFUSALS.NO_SEAT_ARRANGEMENT.message, HANDOFF_REFUSALS.NO_SEAT_ARRANGEMENT.key);
  } catch (error) {
    const code = ticketResponsibilityRefusalCode(error);
    const refusal = code ? direction.refusals[code] : undefined;
    if (refusal) return actionError(refusal.message, refusal.key);
    const expected = ticketActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

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
 * permission and record-level read access to the ticket (`assertTicketReadable`); the provider's command refuses everyone who is not MSP
 * staff, a board the arrangement does not share, and a stale revision. Returns the ticket's
 * responsibility as it now stands, so the chip refreshes from the same answer.
 */
export const handTicketToClientIt = withAuth(async (
  user,
  { tenant },
  input: HandTicketToClientItInput,
): Promise<{ state: TicketResponsibilityState } | TicketActionError> => {
  try {
    const session = await openHandoffSession(user, tenant, 'client_it');
    if (isSessionError(session)) return session;
    return await handOffTicket(session, input, { fullState: true });
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

const isSessionError = (value: HandoffSession | TicketActionError): value is TicketActionError =>
  'actionError' in value || 'permissionError' in value;

export interface BulkHandoffInput {
  /** The selected tickets, each with the revision of the row it was selected from. */
  tickets: BulkHandoffItem[];
  /** A shared note, applied to every ticket. Required. */
  note: string;
  /** Names a technician for every ticket. Hand to client IT only; a handoff to the MSP ignores it. */
  technicianUserId?: string | null;
  /** Fixed when the dialog opens and kept across retries: each ticket's operation id derives from it. */
  submissionId: string;
}

/** A ticket's new state after a bulk handoff: where responsibility stands and the revision the next handoff must name. */
export type BulkHandoffTicketState = Pick<TicketResponsibilityState, 'responsibility' | 'revision'>;

export interface BulkHandoffResult {
  results: Array<BulkHandoffTicketResult<BulkHandoffTicketState>>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// LEVERAGE: friction action-error-localization-top-level — localizeActionError rewrites only a top-level payload, so each row of a bulk result is translated by hand here; bulk delete and move return untranslated per-ticket messages for the same reason
/** A refusal as the caller's locale tells it, for one row of a bulk result (the action boundary only translates the top level). */
async function localized(error: TicketActionError): Promise<{ message: string; messageKey?: string }> {
  const translated: TicketActionError = await localizeActionError(error);
  const messageKey = getActionErrorMessageKey(error);
  return {
    message: (translated as { actionError?: string }).actionError ?? (translated as { permissionError?: string }).permissionError ?? '',
    ...(messageKey ? { messageKey } : {}),
  };
}

/**
 * Hands each selected ticket over on its own. The caller is authorized once; every ticket then goes through the
 * single handoff's checks (`handOffTicket`) in its own command, so a ticket the caller cannot read, one whose
 * revision is stale, one that is already handed over, or one outside the arrangement is refused and left exactly
 * as it was, while the others go through. Each ticket's operation id derives from the submission id and the
 * ticket, so submitting the same selection again (a lost response) replays the receipts instead of repeating.
 */
async function bulkHandOff(
  user: IUserWithRoles, tenant: string, direction: TicketHandoffDirection, input: BulkHandoffInput,
): Promise<BulkHandoffResult | TicketActionError> {
  const definition = DIRECTIONS[direction];
  const unavailable = () => actionError(definition.unavailable.message, definition.unavailable.key);
  try {
    const session = await openHandoffSession(user, tenant, direction);
    if (isSessionError(session)) return session;

    if (!input || !Array.isArray(input.tickets) || input.tickets.length === 0 || input.tickets.length > MAX_BULK_HANDOFF_TICKETS ||
        typeof input.submissionId !== 'string' || !uuid.test(input.submissionId)) {
      return actionError(definition.refusals.INVALID_HANDOFF.message, definition.refusals.INVALID_HANDOFF.key);
    }
    // Before any ticket is looked at: a caller who is not offered this handoff learns nothing about the tickets.
    if (!await session.provider()) return unavailable();

    const results = await runBulkHandoff<BulkHandoffTicketState>(
      input.tickets,
      async (item) => {
        const ticketId = typeof item?.ticketId === 'string' ? item.ticketId : '';
        // A malformed id is a ticket that is not there; it is not looked up.
        if (!uuid.test(ticketId)) return localized(actionError(NOT_AVAILABLE.message, NOT_AVAILABLE.key));
        const outcome = await handOffTicket(session, {
          ticketId,
          expectedRevision: item.expectedRevision,
          note: input.note,
          technicianUserId: direction === 'client_it' ? input.technicianUserId ?? null : null,
          operationId: bulkHandoffOperationId(input.submissionId, direction, ticketId),
        }, { fullState: false });
        if ('state' in outcome) return { state: { responsibility: outcome.state.responsibility, revision: outcome.state.revision } };
        // A ticket the caller cannot read is "not found or not available", never "permission denied": that would confirm it exists.
        return localized(isActionPermissionErrorOf(outcome) ? actionError(NOT_AVAILABLE.message, NOT_AVAILABLE.key) : outcome);
      },
      async (item, error) => {
        console.error(`Bulk handoff of ticket ${item?.ticketId} failed unexpectedly:`, error);
        return localized(actionError(UNEXPECTED.message, UNEXPECTED.key));
      },
    );
    return { results };
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

const isActionPermissionErrorOf = (error: TicketActionError): boolean => 'permissionError' in error;

/** MSP staff hand the selected tickets to client IT, each on its own (see `bulkHandOff`). Not available unless the seat shape is released for the tenant. */
export const bulkHandTicketsToClientIt = withAuth(async (
  user, { tenant }, input: BulkHandoffInput,
): Promise<BulkHandoffResult | TicketActionError> => bulkHandOff(user, tenant, 'client_it', input));

/** A seat technician hands the selected tickets to the MSP, each on its own (see `bulkHandOff`). Not available unless the seat shape is released for the tenant. */
export const bulkHandTicketsToMsp = withAuth(async (
  user, { tenant }, input: BulkHandoffInput,
): Promise<BulkHandoffResult | TicketActionError> => bulkHandOff(user, tenant, 'msp', input));

/**
 * The seat technicians a named-technician handoff of these tickets may choose from: the technicians of each readable
 * selected ticket's arrangement, once each, by display name. Hand to client IT only; empty for anyone else.
 */
export const getBulkHandoffTechnicians = withAuth(async (
  user, { tenant }, ticketIds: string[],
): Promise<{ technicians: Array<{ user_id: string; display_name: string }> } | TicketActionError> => {
  try {
    const session = await openHandoffSession(user, tenant, 'client_it');
    if (isSessionError(session)) return session;
    const provider = await session.provider();
    const ids = [...new Set((Array.isArray(ticketIds) ? ticketIds : []).filter((id) => typeof id === 'string' && uuid.test(id)))]
      .slice(0, MAX_BULK_HANDOFF_TICKETS);
    if (!provider || ids.length === 0) return { technicians: [] };
    const technicians = new Map<string, { user_id: string; display_name: string }>();
    for (const ticketId of ids) {
      if (await assertTicketReadable(ticketId) !== true) continue;
      const state = await withTransaction(session.db, (trx) => provider.load(trx, tenant, ticketId));
      for (const technician of state?.technicians ?? []) technicians.set(technician.user_id, technician);
    }
    return { technicians: [...technicians.values()].sort((a, b) => a.display_name.localeCompare(b.display_name)) };
  } catch (error) {
    const expected = ticketActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
