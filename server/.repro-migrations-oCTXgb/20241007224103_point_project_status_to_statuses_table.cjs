exports.up = function(knex) {
  return knex.schema.table('projects', function(table) {
    table.foreign(['status', 'tenant'])
      .references(['status_id', 'tenant'])
      .inTable('statuses')
  });
};

exports.down = function(knex) {
  return knex.schema.table('projects', function(table) {
    table.dropForeign(['status', 'tenant']);
  });
};