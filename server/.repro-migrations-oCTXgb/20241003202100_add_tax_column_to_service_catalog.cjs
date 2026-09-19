exports.up = function(knex) {
    return knex.schema.table('service_catalog', function(table) {
      table.boolean('is_taxable').defaultTo(true);
      table.string('tax_region').nullable();
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('service_catalog', function(table) {
      table.dropColumn('is_taxable');
      table.dropColumn('tax_region');
    });
  };
  