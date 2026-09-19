exports.up = function(knex) {
  return knex.schema.alterTable('next_number', function(table) {
    table.integer('padding_length').defaultTo(6);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('next_number', function(table) {
    table.dropColumn('padding_length');
  });
};
