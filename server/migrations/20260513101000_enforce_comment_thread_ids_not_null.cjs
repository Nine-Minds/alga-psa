// Enforce thread_id NOT NULL on both comment tables.
//
// finalizeBackfill repeats the backfill once more here to close the
// rolling-deploy window where stale app instances may still insert NULL
// thread_id after the dedicated backfill migration ran. truncateLocalDataIfNeeded
// is a defensive net: 20260513100800 already empties the coordinator parent
// heap (its NULL shadow rows are invisible to Citus-routed DML but break
// ALTER ... SET NOT NULL, which scans the parent heap directly). All steps are
// idempotent / no-op on clean and non-Citus environments.
exports.up = async function up(knex) {
  await finalizeBackfill(knex, {
    sourceTable: 'comments',
    idColumn: 'comment_id',
    parentColumn: 'ticket_id',
    parentIsTask: false,
  });
  await finalizeBackfill(knex, {
    sourceTable: 'project_task_comments',
    idColumn: 'task_comment_id',
    parentColumn: 'task_id',
    parentIsTask: true,
  });

  await truncateLocalDataIfNeeded(knex, 'comments');
  await truncateLocalDataIfNeeded(knex, 'project_task_comments');

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM comments WHERE thread_id IS NULL) THEN
        RAISE EXCEPTION 'comments.thread_id still contains NULL values after self-healing backfill; investigate orphan or invalid rows before enforcing NOT NULL';
      END IF;

      IF EXISTS (SELECT 1 FROM project_task_comments WHERE thread_id IS NULL) THEN
        RAISE EXCEPTION 'project_task_comments.thread_id still contains NULL values after self-healing backfill; investigate orphan or invalid rows before enforcing NOT NULL';
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

async function truncateLocalDataIfNeeded(knex, table) {
  const citus = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled"
  );
  if (!citus.rows?.[0]?.enabled) {
    return;
  }

  const distributed = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition
       WHERE logicalrelid = ?::regclass
     ) AS is_distributed`,
    [table]
  );
  if (!distributed.rows?.[0]?.is_distributed) {
    return;
  }

  // 0-byte parent heap = cleanly distributed; nothing to do (also the no-op
  // guard for re-runs).
  const heap = await knex.raw(
    `SELECT pg_relation_size(?::regclass) AS bytes`,
    [table]
  );
  if (Number(heap.rows?.[0]?.bytes ?? 0) === 0) {
    return;
  }

  // ⚠️ UNSAFE PATTERN — do not copy into new migrations.
  // truncate_local_data_after_distributing_table() issues a TRUNCATE that
  // CASCADEs across the whole FK graph. Distributed tables in the cascade only
  // lose stranded coordinator-local rows, but any NON-distributed table in the
  // recursive FK closure loses ALL of its data (a local table's coordinator
  // heap is its only copy). Before ever calling this again, walk the FK
  // closure (pg_constraint) and abort unless every member is distributed
  // (pg_dist_partition). Retained as history, not as an example.
  await knex.raw(`SELECT truncate_local_data_after_distributing_table(?::regclass)`, [table]);
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
    `[enforce_comment_thread_ids_not_null] Removed ${deletedComments} legacy project task comments ` +
    `and ${deletedReactions} reactions whose project task no longer exists before final thread backfill`
  );
}

function chunk(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

async function finalizeBackfill(knex, { sourceTable, idColumn, parentColumn, parentIsTask }) {
  if (parentIsTask) {
    await pruneOrphanProjectTaskComments(knex);
  }

  const { rows } = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM ${sourceTable} WHERE thread_id IS NULL) AS has_gap`
  );
  if (!rows?.[0]?.has_gap) {
    return;
  }

  if (parentIsTask) {
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
        c.${idColumn},
        NULL,
        c.${parentColumn},
        c.${idColumn},
        false,
        0,
        COALESCE(c.created_at, now()),
        COALESCE(c.created_at, now()),
        c.user_id
      FROM ${sourceTable} c
      JOIN project_tasks pt
        ON pt.tenant = c.tenant
       AND pt.task_id = c.${parentColumn}
      WHERE c.thread_id IS NULL
      ON CONFLICT (tenant, thread_id) DO NOTHING
    `);
  } else {
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
        ${idColumn},
        ${parentColumn},
        NULL,
        ${idColumn},
        is_internal,
        0,
        COALESCE(created_at, now()),
        metadata->'email'->>'messageId',
        COALESCE(created_at, now()),
        user_id
      FROM ${sourceTable}
      WHERE thread_id IS NULL
      ON CONFLICT (tenant, thread_id) DO NOTHING
    `);
  }

  // UPDATE ... FROM with a co-located join is the Citus-friendly pattern for
  // cross-table writes — Citus rejects multi-table CTE modifications and may
  // also struggle with correlated EXISTS subqueries inside UPDATE on some
  // configurations, but UPDATE ... FROM on the distribution column works.
  await knex.raw(`
    UPDATE ${sourceTable} c
    SET thread_id = ct.thread_id
    FROM comment_threads ct
    WHERE c.tenant = ct.tenant
      AND ct.thread_id = c.${idColumn}
      AND c.thread_id IS NULL
  `);
}

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
