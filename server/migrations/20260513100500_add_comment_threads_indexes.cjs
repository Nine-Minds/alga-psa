/**
 * Add lookup indexes for comment thread list ordering and email correlation.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS comment_threads_ticket_idx
    ON comment_threads (tenant, ticket_id, last_activity_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS comment_threads_task_idx
    ON comment_threads (tenant, project_task_id, last_activity_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS comment_threads_email_msgid_idx
    ON comment_threads (tenant, email_message_id)
    WHERE email_message_id IS NOT NULL
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS comment_threads_email_msgid_idx');
  await knex.schema.raw('DROP INDEX IF EXISTS comment_threads_task_idx');
  await knex.schema.raw('DROP INDEX IF EXISTS comment_threads_ticket_idx');
};
