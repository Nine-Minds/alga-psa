import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

interface PublishRmmTicketCreatedArgs {
  tenantId: string;
  ticketId: string;
  source: string;
  trx?: Knex.Transaction;
}

/**
 * Publishes the standard TICKET_CREATED event for an RMM-created ticket so the
 * tenant's configured ticket-created notifications fire. Mirrors what
 * TicketModelEventPublisher does internally (system actor, after-commit when a
 * transaction is supplied) but without importing @alga-psa/tickets — that would
 * create a shared -> tickets dependency cycle.
 */
export async function publishRmmTicketCreated({
  tenantId,
  ticketId,
  source,
  trx,
}: PublishRmmTicketCreatedArgs): Promise<void> {
  const publish = () =>
    publishWorkflowEvent({
      eventType: 'TICKET_CREATED' as any,
      payload: { tenantId, ticketId, source },
      ctx: { tenantId, actor: { actorType: 'SYSTEM' } },
    });

  // When the creating transaction is supplied, defer until it commits so
  // subscribers never race the still-open transaction (owned by a
  // withTransaction frame).
  if (trx) {
    registerAfterCommit(trx, publish, `TICKET_CREATED ticket=${ticketId}`);
    return;
  }

  try {
    await publish();
  } catch (error) {
    console.error('Failed to publish TICKET_CREATED event:', error);
  }
}
