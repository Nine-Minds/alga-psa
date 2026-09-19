/**
 * Add applies_to_service_id column to invoice_items table
 * This enables service-based discount application
 */
exports.up = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    table.uuid('applies_to_service_id').nullable();
    // Add foreign key constraint that includes tenant
    table.foreign(['tenant', 'applies_to_service_id']).references(['tenant', 'service_id']).inTable('service_catalog');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    table.dropForeign(['tenant', 'applies_to_service_id']);
    table.dropColumn('applies_to_service_id');
  });
};
