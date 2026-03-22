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
exports.up = async function up(knex) {
  await knex.schema.createTable('service_catalog_mode_defaults', (table) => {
    table.uuid('default_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.uuid('service_id').notNullable();
    table.text('billing_mode').notNullable();
    table.string('currency_code', 3).notNullable();
    table.integer('rate').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('CASCADE');
    table.unique(
      ['tenant', 'service_id', 'billing_mode', 'currency_code'],
      'service_catalog_mode_defaults_tenant_service_mode_currency_uq'
    );
    table.index(['tenant', 'service_id'], 'service_catalog_mode_defaults_tenant_service_idx');
  });

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
