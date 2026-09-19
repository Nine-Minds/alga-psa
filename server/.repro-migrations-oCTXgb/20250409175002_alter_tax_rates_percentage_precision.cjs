exports.up = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    // Change precision to allow 4 decimal places (10 total digits)
    table.decimal('tax_percentage', 10, 4).notNullable().alter();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    // Revert back to original precision (5 total digits, 2 decimal places)
    // Note: This might cause data loss if values with higher precision exist.
    table.decimal('tax_percentage', 5, 2).notNullable().alter();
  });
};
