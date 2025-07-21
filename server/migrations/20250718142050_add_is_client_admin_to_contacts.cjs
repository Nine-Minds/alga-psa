exports.up = function(knex) {
  return knex.schema.alterTable('contacts', function(table) {
    table.boolean('is_client_admin').defaultTo(false).notNullable();
    table.index('is_client_admin');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('contacts', function(table) {
    table.dropColumn('is_client_admin');
  });
};