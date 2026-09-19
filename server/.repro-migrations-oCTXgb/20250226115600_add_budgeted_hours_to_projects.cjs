exports.up = function(knex) {
  return knex.schema.alterTable('projects', function(table) {
    table.bigInteger('budgeted_hours').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('projects', function(table) {
    table.dropColumn('budgeted_hours');
  });
};
