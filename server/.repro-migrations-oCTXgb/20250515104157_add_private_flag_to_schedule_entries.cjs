exports.up = function(knex) {
  return knex.schema.table('schedule_entries', function(table) {
    table.boolean('is_private').notNullable().defaultTo(false);
  });
};

exports.down = function(knex) {
  return knex.schema.table('schedule_entries', function(table) {
    table.dropColumn('is_private');
  });
};