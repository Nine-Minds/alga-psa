/**
 * Create mode-specific service catalog default pricing table.
 *
 * Stores optional catalog defaults by service + billing mode + currency.
 * Contract-line pricing still controls final billing behavior.
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  } else {
    console.warn(`[${tableName}] Skipping create_distributed_table (function unavailable)`);
  }
}

exports.up = async function up(knex) {
  await knex.schema.createTable('service_catalog_mode_defaults', (table) => {
    table.uuid('default_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.uuid('service_id').notNullable();
    table.text('billing_mode').notNullable();
    table.string('currency_code', 3).notNullable();
    table.integer('rate').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'default_id']);
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('CASCADE');
    table.unique(
      ['tenant', 'service_id', 'billing_mode', 'currency_code'],
      'service_catalog_mode_defaults_tenant_service_mode_currency_uq'
    );
    table.index(['tenant', 'service_id'], 'service_catalog_mode_defaults_tenant_service_idx');
  });

  await distributeIfCitus(knex, 'service_catalog_mode_defaults');

  await knex.raw(`
    ALTER TABLE service_catalog_mode_defaults
    ADD CONSTRAINT service_catalog_mode_defaults_billing_mode_check
    CHECK (billing_mode IN ('fixed', 'hourly', 'usage'))
  `);

  await knex.raw(`
    ALTER TABLE service_catalog_mode_defaults
    ADD CONSTRAINT service_catalog_mode_defaults_rate_check
    CHECK (rate >= 0)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('service_catalog_mode_defaults');
};

exports.config = { transaction: false };
