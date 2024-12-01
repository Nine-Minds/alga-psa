exports.up = function(knex) {
  return knex.schema
    .alterTable('time_entries', function(table) {
      table.boolean('invoiced').defaultTo(false);
    })
    .alterTable('usage_tracking', function(table) {
      table.boolean('invoiced').defaultTo(false);
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('time_entries', function(table) {
      table.dropColumn('invoiced');
    })
    .alterTable('usage_tracking', function(table) {
      table.dropColumn('invoiced');
    });
};
