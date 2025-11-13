/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('contract_template_line_service_usage_config', (table) => {
    table.decimal('base_rate', 10, 2).nullable();
    table.integer('minimum_usage').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('contract_template_line_service_usage_config', (table) => {
    table.dropColumn('base_rate');
    table.dropColumn('minimum_usage');
  });
};
