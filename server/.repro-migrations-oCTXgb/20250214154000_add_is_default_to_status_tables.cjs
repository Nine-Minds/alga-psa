exports.up = function(knex) {
  return knex.schema
    .alterTable('statuses', function(table) {
      table.boolean('is_default').defaultTo(false);
    })
    .alterTable('standard_statuses', function(table) {
      table.boolean('is_default').defaultTo(false);
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('statuses', function(table) {
      table.dropColumn('is_default');
    })
    .alterTable('standard_statuses', function(table) {
      table.dropColumn('is_default');
    });
};
