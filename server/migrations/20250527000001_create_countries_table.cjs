/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('countries', function(table) {
    table.string('code', 2).primary().comment('ISO 3166-1 alpha-2 country code');
    table.string('name', 100).notNullable().comment('Country name');
    table.boolean('is_active').defaultTo(true).comment('Whether country is available for selection');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('countries');
};