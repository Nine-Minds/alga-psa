exports.up = function(knex) {
  return knex.schema.table('statuses', function(table) {
    table.renameColumn('status_name', 'name');
  });
};

exports.down = function(knex) {
  return knex.schema.table('statuses', function(table) {
    table.renameColumn('name', 'status_name');
  });
};
