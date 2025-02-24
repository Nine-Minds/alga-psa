exports.up = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    // Change tax_amount to bigint to store cents
    table.bigInteger('tax_amount').alter();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoice_items', function(table) {
    // Change back to numeric
    table.decimal('tax_amount', 10, 2).alter();
  });
};