exports.up = function(knex) {
    return knex.schema.table('companies', function(table) {
      table.unique('company_id');
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('companies', function(table) {
      table.dropUnique('company_id');
    });
  };