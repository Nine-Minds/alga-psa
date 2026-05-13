const BATCH_SIZE = 1000;

/**
 * Backfill one top-level thread per existing project task comment.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await knex.raw(
      `
        WITH batch AS (
          SELECT
            tenant,
            task_comment_id,
            task_id,
            created_at,
            user_id
          FROM project_task_comments
          WHERE thread_id IS NULL
          ORDER BY created_at, task_comment_id
          LIMIT ?
        ),
        inserted AS (
          INSERT INTO comment_threads (
            tenant,
            thread_id,
            ticket_id,
            project_task_id,
            root_comment_id,
            is_internal,
            reply_count,
            last_activity_at,
            created_at,
            created_by
          )
          SELECT
            tenant,
            task_comment_id,
            NULL,
            task_id,
            task_comment_id,
            false,
            0,
            COALESCE(created_at, now()),
            COALESCE(created_at, now()),
            user_id
          FROM batch
          ON CONFLICT (tenant, thread_id) DO NOTHING
        )
        UPDATE project_task_comments c
        SET thread_id = b.task_comment_id
        FROM batch b
        WHERE c.tenant = b.tenant
          AND c.task_comment_id = b.task_comment_id
          AND c.thread_id IS NULL
        RETURNING c.task_comment_id
      `,
      [BATCH_SIZE]
    );

    if (result.rowCount === 0) {
      break;
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('project_task_comments', (table) => {
    table.dropForeign(['tenant', 'thread_id'], 'project_task_comments_thread_fk');
  });

  await knex.raw(`
    UPDATE project_task_comments
    SET thread_id = NULL
    WHERE thread_id = task_comment_id
      AND parent_comment_id IS NULL
  `);

  await knex.raw(`
    DELETE FROM comment_threads ct
    WHERE ct.ticket_id IS NULL
      AND ct.thread_id = ct.root_comment_id
      AND NOT EXISTS (
        SELECT 1
        FROM project_task_comments c
        WHERE c.tenant = ct.tenant
          AND c.thread_id = ct.thread_id
      )
  `);

  await knex.schema.alterTable('project_task_comments', (table) => {
    table
      .foreign(['tenant', 'thread_id'], 'project_task_comments_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads');
  });
};
