import type { Knex } from 'knex';

/** Shared with database mutation triggers; held until commit/rollback. */
export async function lockTenantBilling(trx: Knex.Transaction, tenant: string): Promise<void> {
  await trx.raw("select pg_advisory_xact_lock(hashtextextended(? || ':billing-semantics', 0))", [tenant]);
  // This write also acquires the trigger's lock on the tenant's Citus shard.
  // Coordinator advisory locks alone do not serialize worker-side mutations.
  await trx.raw('insert into billing_semantics_locks (tenant) values (?) on conflict (tenant) do update set tenant = excluded.tenant', [tenant]);
}
