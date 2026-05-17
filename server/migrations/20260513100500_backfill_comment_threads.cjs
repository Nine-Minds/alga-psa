// Backfill one top-level thread per existing comment. Two single-table
// statements per surface (INSERT ... ON CONFLICT, then UPDATE ... FROM):
// Citus does not reliably run multi-table WITH...INSERT...UPDATE across two
// distributed tables. Legacy thread_id = comment_id for idempotent reruns.
exports.up = async function up(knex) {
  await backfillTicketComments(knex);
  await backfillProjectTaskComments(knex);
};

async function backfillTicketComments(knex) {
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

  // UPDATE ... FROM on the co-located tenant column: Citus's reliable
  // cross-table write (correlated EXISTS in UPDATE is inconsistently
  // supported). Only touches rows whose thread row now exists.
  await knex.raw(`
    UPDATE comments c
    SET thread_id = ct.thread_id
    FROM comment_threads ct
    WHERE c.tenant = ct.tenant
      AND ct.thread_id = c.comment_id
      AND c.thread_id IS NULL
  `);
}

async function backfillProjectTaskComments(knex) {
  await pruneOrphanProjectTaskComments(knex);

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
      c.tenant,
      c.task_comment_id,
      NULL,
      c.task_id,
      c.task_comment_id,
      false,
      0,
      COALESCE(c.created_at, now()),
      COALESCE(c.created_at, now()),
      c.user_id
    FROM project_task_comments c
    JOIN project_tasks pt
      ON pt.tenant = c.tenant
     AND pt.task_id = c.task_id
    WHERE c.thread_id IS NULL
    ON CONFLICT (tenant, thread_id) DO NOTHING
  `);

  await knex.raw(`
    UPDATE project_task_comments c
    SET thread_id = ct.thread_id
    FROM comment_threads ct
    WHERE c.tenant = ct.tenant
      AND ct.thread_id = c.task_comment_id
      AND c.thread_id IS NULL
  `);
}

async function pruneOrphanProjectTaskComments(knex) {
  // 20260313120000_create_comment_reactions deliberately re-added the
  // project_task_comments -> project_tasks FK as NOT VALID because some hosts
  // already had legacy comments whose task had been deleted. Those rows cannot
  // receive comment_threads: the new thread row must FK to an existing task.
  // Remove them now, matching the cascade behavior the original FK intended.
  const { rows: orphanTasks } = await knex.raw(`
    SELECT c.tenant, c.task_id
    FROM project_task_comments c
    LEFT JOIN project_tasks pt
      ON pt.tenant = c.tenant
     AND pt.task_id = c.task_id
    WHERE pt.task_id IS NULL
    GROUP BY c.tenant, c.task_id
  `);

  if (!orphanTasks?.length) {
    return;
  }

  const hasReactions = await knex.schema.hasTable('project_task_comment_reactions');
  let deletedComments = 0;
  let deletedReactions = 0;

  for (const orphanTask of orphanTasks) {
    const ids = await knex('project_task_comments')
      .select('task_comment_id')
      .where({ tenant: orphanTask.tenant, task_id: orphanTask.task_id });
    const taskCommentIds = ids.map((row) => row.task_comment_id);

    if (hasReactions && taskCommentIds.length > 0) {
      for (const idBatch of chunk(taskCommentIds, 1000)) {
        deletedReactions += Number(await knex('project_task_comment_reactions')
          .where({ tenant: orphanTask.tenant })
          .whereIn('task_comment_id', idBatch)
          .delete());
      }
    }

    deletedComments += Number(await knex('project_task_comments')
      .where({ tenant: orphanTask.tenant, task_id: orphanTask.task_id })
      .delete());
  }

  console.warn(
    `[backfill_comment_threads] Removed ${deletedComments} legacy project task comments ` +
    `and ${deletedReactions} reactions whose project task no longer exists before thread backfill`
  );
}

function chunk(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

/**
 * Reverse the backfill: clear thread_id for legacy rows (where thread_id was
 * derived from the comment_id) and drop their thread rows.
 *
 * Comments whose thread_id was generated by the application layer (i.e. not
 * equal to comment_id, or which already have a parent) are left intact because
 * they predate / outlive this migration.
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

// Backfill issues single-table statements that Citus routes per shard; both
// operations must commit independently and stay outside a wrapping txn so a
// partial failure doesn't undo rows already populated.
exports.config = { transaction: false };
