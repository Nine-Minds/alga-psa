/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('company_tax_settings', (table) => {
    // Drop foreign key constraint first
    table.dropForeign('tax_rate_id', 'company_tax_settings_tax_rate_id_foreign');
    // Then drop the column
    table.dropColumn('tax_rate_id');
  });
  console.log('Dropped tax_rate_id column and FK from company_tax_settings.');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('company_tax_settings', (table) => {
    // Add tax_rate_id column back (assuming it was NOT NULL before)
    // Based on previous schema check, it was NOT NULL.
    table.uuid('tax_rate_id').notNullable();

    // Add foreign key constraint back
    table
      .foreign('tax_rate_id', 'company_tax_settings_tax_rate_id_foreign')
      .references('tax_rate_id')
      .inTable('tax_rates');
      // Add onDelete/onUpdate behavior if it existed previously (schema check didn't show specific behavior)
  });
  console.log('Re-added tax_rate_id column and FK to company_tax_settings.');
  // Note: Data for this column is lost after running 'up' and cannot be restored by 'down'.
  // The previous data migration's 'down' function doesn't repopulate this either.
};
