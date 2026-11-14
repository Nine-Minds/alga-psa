import type { Knex } from 'knex';
import type { OrganizationSlaIdentity } from './organizationSlaClock';

/** Same `sla:<tenant>:<ticket>` advisory-lock key family as the native
 * `acquireTicketSlaLock` (packages/sla slaLock.ts), keyed on the ticket owner's
 * tenant and ticket. An org-clock write and a native SLA write on the same shared
 * ticket therefore serialise against each other instead of racing.
 * Keep the key text and hash function identical to slaLock.ts. */
export async function acquireOrganizationSlaLock(trx: Knex.Transaction, identity: Pick<OrganizationSlaIdentity, 'sourceTenant' | 'ticketId'>): Promise<void> {
  await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [`sla:${identity.sourceTenant}:${identity.ticketId}`]);
}
