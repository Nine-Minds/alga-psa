exports.up = function(knex) {
  return knex.schema.alterTable('invoices', function(table) {
    // Add unique constraint on invoice_number and tenant
    table.unique(['invoice_number', 'tenant'], 'unique_invoice_number_per_tenant');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoices', function(table) {
    // Remove the unique constraint
    table.dropUnique(['invoice_number', 'tenant'], 'unique_invoice_number_per_tenant');
  });
};
