exports.up = function(knex) {
    return knex.schema.table('usage_tracking', function(table) {
      table.string('tax_region').nullable();
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('usage_tracking', function(table) {
      table.dropColumn('tax_region');
    });
  };