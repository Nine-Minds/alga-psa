/**
 * Add an explicit start date to project tasks. Tasks previously carried only
 * due_date, so any timeline view had to infer where a bar began. The column is
 * nullable on purpose: existing tasks keep inferring their start from the
 * dependency chain, and only tasks a user has actually dated render as fixed.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE project_tasks
    ADD COLUMN IF NOT EXISTS start_date timestamptz NULL
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE project_tasks
    DROP COLUMN IF EXISTS start_date
  `);
};
