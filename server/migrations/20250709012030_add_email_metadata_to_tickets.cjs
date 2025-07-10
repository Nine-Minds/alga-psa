/**
 * Add email_metadata column to tickets table for email threading support
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    table.jsonb('email_metadata').nullable().comment('Email threading metadata for reply detection');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('tickets', function(table) {
    table.dropColumn('email_metadata');
  });
};