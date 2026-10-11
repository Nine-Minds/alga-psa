/**
 * Template tasks carried only duration_days (phase start -> due date), so a task
 * created from a template never got a start date. start_offset_days is the
 * matching offset for the start: days from the phase start to the task start.
 * Nullable: existing template tasks keep producing undated starts.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE project_template_tasks
    ADD COLUMN IF NOT EXISTS start_offset_days integer NULL
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE project_template_tasks
    DROP COLUMN IF EXISTS start_offset_days
  `);
};
