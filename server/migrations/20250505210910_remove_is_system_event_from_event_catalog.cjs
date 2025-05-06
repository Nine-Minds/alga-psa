'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('event_catalog', (table) => {
    // Drop the is_system_event column
    table.dropColumn('is_system_event');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('event_catalog', (table) => {
    // Add the is_system_event column back with its original default
    table.boolean('is_system_event').defaultTo(false);
  });
};
