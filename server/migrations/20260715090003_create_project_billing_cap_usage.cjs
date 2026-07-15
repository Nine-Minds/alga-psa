/**
 * Create the transactional cap-usage ledger for project billing.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('project_billing_cap_usage', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('cap_usage_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('config_id').notNullable();
    table.bigInteger('billed_amount').notNullable().defaultTo(0);
    table.bigInteger('written_down_amount').notNullable().defaultTo(0);
    table.jsonb('notified_thresholds').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'cap_usage_id']);
    table.unique(['tenant', 'config_id'], {
      indexName: 'project_billing_cap_usage_tenant_config_unique'
    });
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'config_id'], 'project_billing_cap_usage_config_fk')
      .references(['tenant', 'config_id'])
      .inTable('project_billing_configs')
      .onDelete('CASCADE');
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('project_billing_cap_usage');
};
