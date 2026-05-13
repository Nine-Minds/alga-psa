const BATCH_SIZE = 1000;

/**
 * Backfill one top-level thread per existing ticket comment.
 *
 * Legacy thread_id is set to the comment_id for deterministic, idempotent
 * reruns. Future writes use generated thread IDs.
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
            comment_id,
            ticket_id,
            is_internal,
            created_at,
            user_id,
            metadata
          FROM comments
          WHERE thread_id IS NULL
          ORDER BY created_at, comment_id
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
            email_message_id,
            created_at,
            created_by
          )
          SELECT
            tenant,
            comment_id,
            ticket_id,
            NULL,
            comment_id,
            is_internal,
            0,
            COALESCE(created_at, now()),
            metadata->'email'->>'messageId',
            COALESCE(created_at, now()),
            user_id
          FROM batch
          ON CONFLICT (tenant, thread_id) DO NOTHING
        )
        UPDATE comments c
        SET thread_id = b.comment_id
        FROM batch b
        WHERE c.tenant = b.tenant
          AND c.comment_id = b.comment_id
          AND c.thread_id IS NULL
        RETURNING c.comment_id
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
  await knex.schema.alterTable('comments', (table) => {
    table.dropForeign(['tenant', 'thread_id'], 'comments_thread_fk');
  });

  await knex.raw(`
    UPDATE comments
    SET thread_id = NULL
    WHERE thread_id = comment_id
      AND parent_comment_id IS NULL
  `);

  await knex.raw(`
    DELETE FROM comment_threads ct
    WHERE ct.project_task_id IS NULL
      AND ct.thread_id = ct.root_comment_id
      AND NOT EXISTS (
        SELECT 1
        FROM comments c
        WHERE c.tenant = ct.tenant
          AND c.thread_id = ct.thread_id
      )
  `);

  await knex.schema.alterTable('comments', (table) => {
    table
      .foreign(['tenant', 'thread_id'], 'comments_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads');
  });
};
