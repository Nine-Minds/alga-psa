/**
 * Enforce thread_id after the staged backfills have populated legacy rows.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM comments WHERE thread_id IS NULL LIMIT 1) THEN
        RAISE EXCEPTION 'comments.thread_id contains NULL values; run backfill before enforcing NOT NULL';
      END IF;

      IF EXISTS (SELECT 1 FROM project_task_comments WHERE thread_id IS NULL LIMIT 1) THEN
        RAISE EXCEPTION 'project_task_comments.thread_id contains NULL values; run backfill before enforcing NOT NULL';
      END IF;
    END $$;
  `);

  await knex.schema.alterTable('comments', (table) => {
    table.uuid('thread_id').notNullable().alter();
  });

  await knex.schema.alterTable('project_task_comments', (table) => {
    table.uuid('thread_id').notNullable().alter();
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('project_task_comments', (table) => {
    table.uuid('thread_id').nullable().alter();
  });

  await knex.schema.alterTable('comments', (table) => {
    table.uuid('thread_id').nullable().alter();
  });
};
