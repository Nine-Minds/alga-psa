exports.up = function(knex) {
  return knex.schema
    .alterTable('channels', function(table) {
      table.boolean('is_default').defaultTo(false);
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('channels', function(table) {
      table.dropColumn('is_default');
    });
};
