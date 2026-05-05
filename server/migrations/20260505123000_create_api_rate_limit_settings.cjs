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
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('api_rate_limit_settings');
};
