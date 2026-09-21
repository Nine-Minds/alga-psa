import type { Knex } from 'knex';
import type { OrganizationSlaIdentity } from './organizationSlaClock';

/** An MSP obligation is not the customer ticket's native SLA. Keep both locks
 * independent even when UUIDs collide; never omit the policy-owning tenant. */
export async function acquireOrganizationSlaLock(trx: Knex.Transaction, identity: OrganizationSlaIdentity): Promise<void> {
  await trx.raw('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
    `sla:organization:${identity.tenant}:${identity.obligationId}`,
  ]);
}

