/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('invoices', (table) => {
    table.uuid('billing_cycle_id')
      .nullable()
      .references('billing_cycle_id')
      .inTable('company_billing_cycles')
      .onDelete('SET NULL');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('invoices', (table) => {
    table.dropColumn('billing_cycle_id');
  });
};
