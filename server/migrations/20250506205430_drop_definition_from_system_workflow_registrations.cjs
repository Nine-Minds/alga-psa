'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('system_workflow_registrations', (table) => {
    table.dropColumn('definition');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('system_workflow_registrations', (table) => {
    // Add the column back as it was, including the NOT NULL constraint.
    // If there's a concern about data inserted while the column was dropped,
    // this might need a default value or be made nullable temporarily.
    table.jsonb('definition').notNullable();
  });
};