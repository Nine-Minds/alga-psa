exports.up = function(knex) {
    return knex.schema.table('time_entries', function(table) {
      table.uuid('service_id');
      table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog')
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('time_entries', function(table) {
      table.dropForeign(['tenant', 'service_id']);
      table.dropColumn('service_id');
      table.dropColumn('tenant');
    });
  };