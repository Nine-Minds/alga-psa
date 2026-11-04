// Compatibility re-export. The shared ticket authorization mechanism lives in
// @alga-psa/authorization so lower-level packages can use it without depending
// on the tickets composition package.
export * from '@alga-psa/authorization/ticketRecordAuthorization';

import type { Knex } from 'knex';
import type { ITicket, IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { RequestLocalAuthorizationCache, type AuthorizationKernel, type AuthorizationSubject } from '@alga-psa/authorization/kernel';
import { TicketWatcherError } from '@alga-psa/shared/services/tickets/ticketWatcherService';
import { createTicketAuthorizationContext, toTicketAuthorizationRecord } from '@alga-psa/authorization/ticketRecordAuthorization';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The actor passed the coarse permission but not the per-record update decision. */
export class TicketWatcherPermissionError extends Error {
  constructor() {
    super('Permission denied: Cannot update ticket watchers');
    this.name = 'TicketWatcherPermissionError';
  }
}

/**
 * Who is writing. Server actions pass the session user (subject + kernel are
 * resolved here); the REST path passes the subject it already built with
 * `buildAuthorizationPrincipalSubject` (API keys) and its own (possibly
 * enterprise) kernel.
 */
export type TicketWatcherWritePrincipal =
  | { user: IUserWithRoles }
  | { subject: AuthorizationSubject; kernel: AuthorizationKernel };

/**
 * The one authorized watcher command shared by the server actions and the REST
 * service. Inside the caller's transaction, BEFORE `write` touches any watcher
 * row, it loads the ticket (tenant-scoped, row-locked), builds the ticket
 * authorization record and requires the kernel to allow `ticket:update` on that
 * record (plus any mutation guards). Missing, other-tenant and malformed ids all
 * surface as TicketWatcherError('ticket_not_found'); a record-scope denial throws
 * TicketWatcherPermissionError.
 */
export async function runAuthorizedTicketWatcherWrite<T>(input: {
  trx: Knex.Transaction;
  tenant: string;
  ticketId: string;
  principal: TicketWatcherWritePrincipal;
  write: (trx: Knex.Transaction) => Promise<T>;
}): Promise<T> {
  const { trx, tenant, ticketId, principal } = input;
  const ticket = UUID_PATTERN.test(ticketId)
    ? ((await tenantScopedTable(trx, tenant, 'tickets')
        .where({ ticket_id: ticketId })
        .forUpdate()
        .first()) as (Partial<ITicket> & { ticket_id: string }) | undefined)
    : undefined;
  if (!ticket) {
    throw new TicketWatcherError('ticket_not_found');
  }

  let subject: AuthorizationSubject;
  let kernel: AuthorizationKernel;
  let selectedBoardIds: string[] | undefined;
  if ('user' in principal) {
    const context = await createTicketAuthorizationContext(trx, tenant, principal.user);
    subject = context.authorizationSubject;
    kernel = context.authorizationKernel;
    selectedBoardIds = context.selectedBoardIds;
  } else {
    subject = { ...principal.subject, tenant };
    kernel = principal.kernel;
  }

  const record = toTicketAuthorizationRecord(ticket);
  const decision = await kernel.authorizeMutation({
    subject,
    resource: { type: 'ticket', action: 'update', id: ticketId },
    record,
    mutation: { kind: 'update_watchers', record },
    selectedBoardIds,
    requestCache: new RequestLocalAuthorizationCache(),
    knex: trx,
  });
  if (!decision.allowed) {
    throw new TicketWatcherPermissionError();
  }

  return input.write(trx);
}
