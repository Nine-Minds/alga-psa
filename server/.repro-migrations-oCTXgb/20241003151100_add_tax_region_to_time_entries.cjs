exports.up = function(knex) {
    return knex.schema.table('time_entries', function(table) {
      table.string('tax_region').nullable();
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('time_entries', function(table) {
      table.dropColumn('tax_region');
    });
  };