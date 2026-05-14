/**
 * Recover any rows the prior backfill migration left untouched.
 *
 * The earlier 20260513100500_backfill_comment_threads.cjs used a multi-table
 * CTE (WITH batch ..., inserted AS (INSERT INTO comment_threads ...) UPDATE
 * comments ...) that does not execute reliably on Citus: modifying two
 * distributed tables in a single statement is unsupported, and Citus reports
 * success while skipping the UPDATE on some shards. As a result, comments and
 * project_task_comments tables can still contain rows with NULL thread_id
 * when the subsequent NOT-NULL enforcement migration runs.
 *
 * This migration performs the same backfill using single-table statements
 * (one INSERT, one UPDATE per source table), which Citus routes per shard
 * without restriction. It is fully idempotent — ON CONFLICT DO NOTHING and a
 * WHERE thread_id IS NULL filter make safe re-runs.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await recoverTicketComments(knex);
  await recoverProjectTaskComments(knex);
};

async function recoverTicketComments(knex) {
  const { rows } = await knex.raw(
    'SELECT EXISTS (SELECT 1 FROM comments WHERE thread_id IS NULL) AS has_gap'
  );
  if (!rows?.[0]?.has_gap) {
    return;
  }

  await knex.raw(`
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
    FROM comments
    WHERE thread_id IS NULL
    ON CONFLICT (tenant, thread_id) DO NOTHING
  `);

  await knex.raw(`
    UPDATE comments c
    SET thread_id = comment_id
    WHERE thread_id IS NULL
      AND EXISTS (
        SELECT 1 FROM comment_threads ct
        WHERE ct.tenant = c.tenant AND ct.thread_id = c.comment_id
      )
  `);
}

async function recoverProjectTaskComments(knex) {
  const { rows } = await knex.raw(
    'SELECT EXISTS (SELECT 1 FROM project_task_comments WHERE thread_id IS NULL) AS has_gap'
  );
  if (!rows?.[0]?.has_gap) {
    return;
  }

  await knex.raw(`
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
    FROM project_task_comments
    WHERE thread_id IS NULL
    ON CONFLICT (tenant, thread_id) DO NOTHING
  `);

  await knex.raw(`
    UPDATE project_task_comments c
    SET thread_id = task_comment_id
    WHERE thread_id IS NULL
      AND EXISTS (
        SELECT 1 FROM comment_threads ct
        WHERE ct.tenant = c.tenant AND ct.thread_id = c.task_comment_id
      )
  `);
}

/**
 * Reverse the recovery: clear thread_id on rows that this migration filled
 * (thread_id = comment_id, no parent) and drop the matching thread rows. The
 * main backfill migration's down() handles the same logic for rows it owned,
 * so this stays scoped to its own contribution.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`
    UPDATE comments
    SET thread_id = NULL
    WHERE thread_id = comment_id
      AND parent_comment_id IS NULL
  `);

  await knex.raw(`
    UPDATE project_task_comments
    SET thread_id = NULL
    WHERE thread_id = task_comment_id
      AND parent_comment_id IS NULL
  `);

  await knex.raw(`
    DELETE FROM comment_threads ct
    WHERE ct.thread_id = ct.root_comment_id
      AND (
        (ct.project_task_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM comments c
          WHERE c.tenant = ct.tenant AND c.thread_id = ct.thread_id
        ))
        OR
        (ct.ticket_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM project_task_comments c
          WHERE c.tenant = ct.tenant AND c.thread_id = ct.thread_id
        ))
      )
  `);
};

// Recovery runs single-table statements that Citus routes per shard; both
// operations must commit independently and stay outside a wrapping txn so a
// partial failure doesn't roll back rows already filled in.
exports.config = { transaction: false };
