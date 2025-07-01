/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Drop deprecated columns from companies table
  // These columns have been replaced by:
  // - address -> company_locations table (address_line1, address_line2, etc.)
  // - email -> company_locations table (email)
  // - phone_no -> company_locations table (phone)
  // - type -> client_type column
  // - status -> is_inactive boolean column

  await knex.schema.alterTable('companies', function(table) {
    table.dropColumn('address');
    table.dropColumn('email');
    table.dropColumn('phone_no');
    table.dropColumn('type');
    table.dropColumn('status');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Re-add the dropped columns (for rollback purposes)
  await knex.schema.alterTable('companies', function(table) {
    table.text('address');
    table.string('email');
    table.text('phone_no');
    table.text('type');
    table.text('status');
  });
};