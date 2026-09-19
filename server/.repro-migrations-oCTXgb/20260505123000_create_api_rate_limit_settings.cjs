/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('api_rate_limit_settings', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.uuid('api_key_id').nullable();
    table.integer('max_tokens').notNullable();
    table.integer('refill_per_min').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['tenant'], 'api_rate_limit_settings_tenant_idx');
  });

  await knex.raw(`
    CREATE UNIQUE INDEX api_rate_limit_settings_tenant_api_key_uk
    ON api_rate_limit_settings (tenant, api_key_id)
    WHERE api_key_id IS NOT NULL
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX api_rate_limit_settings_tenant_default_uk
    ON api_rate_limit_settings (tenant)
    WHERE api_key_id IS NULL
  `);

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = 'api_rate_limit_settings'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('api_rate_limit_settings', 'tenant', colocate_with => 'tenants')");
    }
  } else {
    console.warn('[create_api_rate_limit_settings] Skipping create_distributed_table (Citus extension unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('api_rate_limit_settings');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
