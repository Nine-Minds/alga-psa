import type { Knex } from 'knex';
import { TicketModelEventPublisher } from '@alga-psa/tickets/lib/adapters/TicketModelEventPublisher';

interface PublishRmmTicketCreatedArgs {
  tenantId: string;
  ticketId: string;
  source: string;
  trx?: Knex.Transaction;
}

export async function publishRmmTicketCreated({
  tenantId,
  ticketId,
  source,
  trx,
}: PublishRmmTicketCreatedArgs): Promise<void> {
  const publisher = new TicketModelEventPublisher(trx);
  await publisher.publishTicketCreated({
    tenantId,
    ticketId,
    metadata: { source },
  });
}
