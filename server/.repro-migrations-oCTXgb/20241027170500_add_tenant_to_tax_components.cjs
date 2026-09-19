exports.up = function (knex) {
  return knex.schema
    .alterTable('tax_components', (table) => {
      table.uuid('tenant').notNullable();
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('tax_components', (table) => {
      table.dropColumn('tenant');
    });
};
