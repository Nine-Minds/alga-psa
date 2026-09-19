/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('contract_template_line_service_hourly_config', (table) => {
    table.decimal('hourly_rate', 10, 2).nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('contract_template_line_service_hourly_config', (table) => {
    table.dropColumn('hourly_rate');
  });
};
