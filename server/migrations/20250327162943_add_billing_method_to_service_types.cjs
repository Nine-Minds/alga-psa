/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('standard_service_types', function(table) {
    // Add the billing_method column, allowing null initially
    table.string('billing_method').nullable();
  });

  // Populate the new column based on existing service type names
  // Adjust these names if they differ in your table
  await knex('standard_service_types')
    .whereIn('name', ['Fixed Price', 'Product', 'License']) // Use names instead of IDs
    .update({ billing_method: 'fixed' });

  await knex('standard_service_types')
    .whereIn('name', ['Hourly Time', 'Usage Based']) // Use names instead of IDs
    .update({ billing_method: 'per_unit' });

  // Optionally, add a check constraint or make the column not nullable
  // after populating, depending on requirements.
  // Example (PostgreSQL):
  // await knex.schema.alterTable('standard_service_types', function(table) {
  //   table.string('billing_method').notNullable().alter();
  //   table.check("billing_method IN ('fixed', 'per_unit')", null, 'standard_service_types_billing_method_check');
  // });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('standard_service_types', function(table) {
    // Remove the check constraint first if added in 'up'
    // table.dropChecks(['standard_service_types_billing_method_check']);
    table.dropColumn('billing_method');
  });
};
