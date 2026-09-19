exports.up = function(knex) {
    return knex.schema.table('companies', function(table) {
      table.string('email');
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('companies', function(table) {
      table.dropColumn('email');
    });
  };