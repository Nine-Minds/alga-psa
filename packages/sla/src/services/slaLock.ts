import { Knex } from 'knex';
import type { OrganizationSlaIdentity } from './organizationSlaClock';

/** An MSP obligation is not the customer ticket's native SLA. Keep both locks
 * independent even when UUIDs collide; never omit the policy-owning tenant. */
export async function acquireOrganizationSlaLock(trx: Knex.Transaction, identity: OrganizationSlaIdentity): Promise<void> {
  await trx.raw('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
    `sla:organization:${identity.tenant}:${identity.obligationId}`,
  ]);
}

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
