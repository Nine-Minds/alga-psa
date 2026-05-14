/**
 * Enforce thread_id NOT NULL on both comment tables.
 *
 * Self-healing: rolling deploys can leave a window where stale app instances
 * keep inserting comments with NULL thread_id even after the dedicated backfill
 * migration runs. This step therefore performs the same backfill one final
 * time — single-table INSERT then UPDATE-with-FROM-join, both Citus-friendly —
 * inside the same migration, immediately before applying the constraint. The
 * INSERT is idempotent (ON CONFLICT DO NOTHING) and the UPDATE only touches
 * rows whose thread row now exists, so previously-completed work is preserved.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
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

async function finalizeBackfill(knex, { sourceTable, idColumn, parentColumn, parentIsTask }) {
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
        tenant,
        ${idColumn},
        NULL,
        ${parentColumn},
        ${idColumn},
        false,
        0,
        COALESCE(created_at, now()),
        COALESCE(created_at, now()),
        user_id
      FROM ${sourceTable}
      WHERE thread_id IS NULL
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
