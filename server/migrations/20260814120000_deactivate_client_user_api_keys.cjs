/**
 * Deactivate existing client-owned API keys.
 *
 * Client-portal identities must not hold tenant API keys. This one-way data
 * migration sweeps active `api_keys` rows whose owner `users` row has the same
 * `tenant` AND `user_id` and `user_type = 'client'`. Matching only `user_id`
 * is not sufficient in a multi-tenant database, so both columns are joined.
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

  await knex('api_keys as ak')
    .update({ active: false, updated_at: knex.fn.now() })
    .where('ak.active', true)
    .whereExists(function () {
      this.select(knex.raw('1'))
        .from('users as u')
        .whereRaw('u.tenant = ak.tenant')
        .whereRaw('u.user_id = ak.user_id')
        .where('u.user_type', 'client');
    });
};

/**
 * Intentionally irreversible: reactivating keys would be unsafe because this
 * migration cannot distinguish rows that were active before the sweep.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
exports.down = async function down(_knex) {};
