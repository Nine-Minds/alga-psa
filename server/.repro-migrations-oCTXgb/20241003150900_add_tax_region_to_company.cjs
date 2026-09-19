exports.up = function(knex) {
    return knex.schema.table('companies', function(table) {
      table.string('tax_region').nullable();
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('companies', function(table) {
      table.dropColumn('tax_region');
    });
  };
  