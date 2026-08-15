/**
 * Deactivate existing client-owned API keys.
 *
 * Client-portal identities must not hold tenant API keys. This one-way data
 * migration deactivates active `api_keys` rows whose owner `users` row has the
 * same `tenant` AND `user_id` and `user_type = 'client'`. Matching only
 * `user_id` is not sufficient in a multi-tenant database, so both columns are
 * used.
 *
 * The sweep is intentionally NOT expressed as a single correlated
 * `api_keys`-to-`users` UPDATE: on Citus that plans as a cross-table modify
 * between tables with different distribution (users is distributed on `tenant`,
 * api_keys is not), which Citus rejects with "relation api_keys is not
 * distributed". Instead the client-owned (tenant, user_id) pairs are resolved
 * first with a plain SELECT, then api_keys is updated per tenant with a simple
 * `user_id` IN (...) filter — routable on both plain Postgres and Citus.
 *
 * Rows are never deleted: keeping inactive records preserves admin inventory
 * and incident/audit context. The down migration is an intentional no-op
 * because it cannot know which rows were active before this migration ran.
 *
 * Idempotent: the `active = false` update is scoped to currently-active rows,
 * so a second run changes nothing.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('api_keys')) || !(await knex.schema.hasTable('users'))) {
    return;
  }

  const clientOwners = await knex('users')
    .where('user_type', 'client')
    .select('tenant', 'user_id');

  const userIdsByTenant = new Map();
  for (const { tenant, user_id } of clientOwners) {
    if (!userIdsByTenant.has(tenant)) {
      userIdsByTenant.set(tenant, []);
    }
    userIdsByTenant.get(tenant).push(user_id);
  }

  const CHUNK = 1000;
  for (const [tenant, userIds] of userIdsByTenant) {
    for (let i = 0; i < userIds.length; i += CHUNK) {
      await knex('api_keys')
        .update({ active: false, updated_at: knex.fn.now() })
        .where('active', true)
        .where('tenant', tenant)
        .whereIn('user_id', userIds.slice(i, i + CHUNK));
    }
  }
};

/**
 * Intentionally irreversible: reactivating keys would be unsafe because this
 * migration cannot distinguish rows that were active before the sweep.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function down(_knex) {};
