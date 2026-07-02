/**
 * Create effective-dated internal labor cost rates.
 *
 * user_id is intentionally a plain nullable UUID with no FK: users is
 * distributed in EE, so referential integrity is enforced in the model layer.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('user_cost_rates', function(table) {
    table.uuid('tenant').notNullable();
    table.uuid('rate_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').nullable();
    table.bigInteger('cost_rate').notNullable();
    table.date('effective_from').notNullable();
    table.date('effective_to').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.uuid('created_by').nullable();

    table.primary(['tenant', 'rate_id']);
  });

  await knex.schema.raw(`
    ALTER TABLE user_cost_rates
    ADD CONSTRAINT user_cost_rates_cost_rate_nonnegative_check
    CHECK (cost_rate >= 0)
  `);

  await knex.schema.raw(`
    ALTER TABLE user_cost_rates
    ADD CONSTRAINT user_cost_rates_effective_range_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
  `);

  await knex.schema.raw(`
    CREATE INDEX user_cost_rates_tenant_user_effective_from_idx
    ON user_cost_rates (tenant, user_id, effective_from)
  `);

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('user_cost_rates', 'tenant')");
  } else {
    console.warn('[create_user_cost_rates] Skipping create_distributed_table (function unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_cost_rates');
};

// Disable transaction for Citus DB compatibility.
exports.config = { transaction: false };
