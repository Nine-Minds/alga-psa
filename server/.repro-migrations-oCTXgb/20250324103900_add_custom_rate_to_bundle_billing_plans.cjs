/**
 * Migration to add custom_rate column to bundle_billing_plans table
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('bundle_billing_plans', function(table) {
      // Add custom_rate column
      table.decimal('custom_rate', 10, 2).nullable();
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('bundle_billing_plans', function(table) {
      // Remove custom_rate column
      table.dropColumn('custom_rate');
    });
};