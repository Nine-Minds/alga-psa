import { Knex } from 'knex';

/**
 * Serialize SLA writes per ticket.
 *
 * Concurrent SLA writers (status-change pause vs. resolution recording,
 * redeliveries, multiple replicas) mutate disjoint columns of the same
 * tickets row and can otherwise interleave their read-then-write sections.
 * A transaction-scoped advisory lock keyed on (tenant, ticket) serializes
 * them without holding the row lock any longer than the write itself.
 *
 * pg_advisory_xact_lock releases automatically at commit/rollback and is
 * safe under pgbouncer transaction pooling (unlike session-scoped advisory
 * locks). Acquisitions are reentrant within the same transaction.
 */
export async function acquireTicketSlaLock(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<void> {
  await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [`sla:${tenant}:${ticketId}`]);
}
