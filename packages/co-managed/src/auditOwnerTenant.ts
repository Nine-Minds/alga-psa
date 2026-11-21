import type { Knex } from 'knex';

/**
 * audit_logs has a BEFORE INSERT trigger (set_tenant_from_current_setting) that files each row under
 * `current_setting('app.current_tenant')` and throws when it is unset. Shared work runs in the actor's
 * (sponsor's) tenant context, so a write that must land in the owning workspace pins the setting to the owner
 * for the duration of `fn` and then puts back whatever was there.
 *
 * Transaction-local (`set_config(..., true)`). The prior value is read with `missing_ok`, so an unset setting
 * does not throw; it is restored as '' (PostgreSQL cannot return a custom setting to "unset" inside a
 * transaction, and the setting reverts to its true prior state when the transaction ends).
 */
export async function withAuditOwnerTenant<T>(trx: Knex.Transaction, tenant: string, fn: () => Promise<T>): Promise<T> {
  const { rows } = await trx.raw("select current_setting('app.current_tenant', true) as prior");
  const prior: string = rows?.[0]?.prior ?? '';
  await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
  try {
    return await fn();
  } finally {
    await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', prior]);
  }
}
