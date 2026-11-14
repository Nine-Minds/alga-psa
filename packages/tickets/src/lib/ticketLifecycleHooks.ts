import type { Knex } from 'knex';

/**
 * Ticket lifecycle hooks. Registration is empty natively, so `dispatchTicketLifecycle`
 * resolves without touching `trx`. Handlers run in the caller's transaction in
 * registration order; the default `isolate` policy catches and logs a handler error
 * so no extension can fail a native ticket write. `rollback` opts a handler into
 * propagating its error (the caller's transaction then rolls back).
 *
 * Dispatched today by extension-owned writers: `handoff`, `firstResponse` and `seatResponsibility`. Not yet dispatched:
 * resolved, reopened, awaitingClient (native writers; adoption is L0c or a follow-up card).
 */

export type TicketLifecycleEvent =
  | { kind: 'resolved'; tenant: string; ticketId: string; statusId?: string; actorUserId?: string }
  | { kind: 'reopened'; tenant: string; ticketId: string; statusId?: string; actorUserId?: string }
  | { kind: 'awaitingClient'; tenant: string; ticketId: string; previous: string | null; next: string | null }
  // Additive (L6b): responsibility changes on shared work, and the first reply from the other organization.
  | { kind: 'handoff'; tenant: string; ticketId: string; relationshipId: string; workId: string; operationId: string;
      transition: 'escalated' | 'handed_back' | 'access_revoked' | 'reopened'; firstEscalatedAt: string | null; occurredAt: string }
  // Seat responsibility (co-managed seat arrangement): who is responsible for the ticket changed. Distinct
  // from `handoff`, which belongs to the L6b relationship workflow. `operationId` is the handoff
  // operation, or null when responsibility returned to the MSP because the ticket left the arrangement's scope.
  | { kind: 'seatResponsibility'; tenant: string; ticketId: string; arrangementId: string;
      from: 'client_it' | 'msp'; to: 'client_it' | 'msp'; operationId: string | null; occurredAt: string; actorUserId?: string }
  | { kind: 'firstResponse'; tenant: string; ticketId: string; relationshipId: string; commentId: string;
      actorTenant: string; actorUserId: string; actorReferenceId: string }
  | { kind: 'beforeSourceChange'; tenant: string; ticketId: string; fields: Record<string, unknown>; actorUserId?: string };

export type TicketLifecycleKind = TicketLifecycleEvent['kind'];

export type TicketLifecycleHandler<K extends TicketLifecycleKind = TicketLifecycleKind> = (
  trx: Knex.Transaction,
  event: Extract<TicketLifecycleEvent, { kind: K }>,
) => Promise<void> | void;

export interface TicketLifecycleHandlerOptions {
  onError?: 'isolate' | 'rollback';
}

interface Registration {
  kind: TicketLifecycleKind;
  handler: TicketLifecycleHandler<any>;
  onError: 'isolate' | 'rollback';
}

const KEY = '__algaTicketLifecycleHandlers';

function registrations(): Registration[] {
  const g = globalThis as Record<string, unknown>;
  return (g[KEY] ??= []) as Registration[];
}

export function registerTicketLifecycleHandler<K extends TicketLifecycleKind>(
  kind: K,
  handler: TicketLifecycleHandler<K>,
  options: TicketLifecycleHandlerOptions = {},
): void {
  registrations().push({ kind, handler, onError: options.onError ?? 'isolate' });
}

export async function dispatchTicketLifecycle(trx: Knex.Transaction, event: TicketLifecycleEvent): Promise<void> {
  const list = registrations();
  if (list.length === 0) return;
  for (const registration of [...list]) {
    if (registration.kind !== event.kind) continue;
    try {
      await registration.handler(trx, event);
    } catch (error) {
      if (registration.onError === 'rollback') throw error;
      console.error('[ticketLifecycle] handler failed; isolated', {
        kind: event.kind,
        tenant: event.tenant,
        ticketId: event.ticketId,
        handler: registration.handler.name || 'anonymous',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Test-only. */
export function resetTicketLifecycleHandlers(): void {
  registrations().length = 0;
}
