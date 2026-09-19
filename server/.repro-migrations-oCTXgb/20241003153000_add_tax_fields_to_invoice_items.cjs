exports.up = function(knex) {
    return knex.schema.table('invoice_items', function(table) {
      table.string('tax_region').nullable();
      table.decimal('tax_rate', 5, 2).notNullable().defaultTo(0);
      table.decimal('tax_amount', 10, 2).notNullable().defaultTo(0);
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('invoice_items', function(table) {
      table.dropColumn('tax_region');
      table.dropColumn('tax_rate');
      table.dropColumn('tax_amount');
    });
  };