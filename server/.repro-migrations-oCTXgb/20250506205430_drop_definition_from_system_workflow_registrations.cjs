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
    // Add the column back as nullable first
    table.jsonb('definition').nullable();
  });

  // Provide a default value for any rows that might have been created
  // while the column was dropped.
  await knex('system_workflow_registrations')
    .whereNull('definition')
    .update({ definition: '{}' });

  // Now, alter the column to be NOT NULL
  await knex.schema.alterTable('system_workflow_registrations', (table) => {
    table.jsonb('definition').notNullable().alter();
  });
};