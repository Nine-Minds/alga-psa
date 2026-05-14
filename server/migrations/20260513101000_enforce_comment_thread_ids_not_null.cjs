/**
 * Enforce thread_id NOT NULL on both comment tables after the backfill has
 * populated every legacy row. Kept separate from the backfill so a partial
 * backfill failure doesn't lock in an invalid constraint — re-run the
 * backfill migration and then this one.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM comments WHERE thread_id IS NULL) THEN
        RAISE EXCEPTION 'comments.thread_id contains NULL values; run backfill before enforcing NOT NULL';
      END IF;

      IF EXISTS (SELECT 1 FROM project_task_comments WHERE thread_id IS NULL) THEN
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

// ALTER COLUMN ... SET NOT NULL against Citus-distributed tables must run
// outside a transaction block.
exports.config = { transaction: false };
