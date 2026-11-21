import type { Knex } from 'knex';

/**
 * The per-tenant lock every billing mutation holds until commit/rollback, so an
 * invoice run never reads billing state another transaction is changing.
 * Plain-Postgres tables also take it from the `billing_semantics_mutation`
 * trigger; Citus-distributed tables cannot carry triggers, so their writers
 * must call this before the first write.
 */
export async function lockTenantBilling(trx: Knex.Transaction, tenant: string): Promise<void> {
  await trx.raw("select pg_advisory_xact_lock(hashtextextended(? || ':billing-semantics', 0))", [tenant]);
  // This write also acquires the trigger's lock on the tenant's Citus shard.
  // Coordinator advisory locks alone do not serialize worker-side mutations.
  await trx.raw('insert into billing_semantics_locks (tenant) values (?) on conflict (tenant) do update set tenant = excluded.tenant', [tenant]);
}
