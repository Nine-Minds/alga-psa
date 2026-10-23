/**
 * Server-side stopwatch: time_tracking_sessions + time_tracking_session_segments (2026-10-10)
 *
 *  - time_tracking_sessions          one row per stopwatch session (running | paused | logged | discarded).
 *                                    At most one OPEN (running/paused) session per user.
 *  - time_tracking_session_segments  (started_at, ended_at) intervals; the source of truth for
 *                                    elapsed time. At most one open segment per session.
 *
 * See docs/plans/2026-10-10-split-ticket-time-tracking-plan.md section 4.
 * Modelled on 20261006120000_create_board_notification_rules.cjs. Both tables are created empty and
 * distributed immediately, so the stale-local-heap trap (citus-migration-gotchas #1) cannot apply;
 * every unique index includes `tenant` (gotcha #3).
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('time_tracking_sessions'))) {
    await knex.schema.createTable('time_tracking_sessions', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('session_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable();
      // `ticket` and `project_task` are the supported types; legacy adapters may store others
      // (e.g. `ad_hoc`), so no CHECK on the value.
      table.text('work_item_type').notNullable();
      table.uuid('work_item_id').nullable();
      table.uuid('service_id').nullable();
      table.text('notes').notNullable().defaultTo('');
      table.text('status').notNullable();
      table.uuid('time_entry_id').nullable();
      table.timestamp('closed_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'session_id']);
      table.index(['tenant', 'work_item_type', 'work_item_id'], 'time_tracking_sessions_work_item_idx');
    });
    await knex.raw(`
      ALTER TABLE time_tracking_sessions
      ADD CONSTRAINT time_tracking_sessions_status_check
      CHECK (status IN ('running', 'paused', 'logged', 'discarded'))
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX time_tracking_sessions_one_open_per_user_uq
      ON time_tracking_sessions (tenant, user_id) WHERE status IN ('running', 'paused')
    `);
  }

  if (!(await knex.schema.hasTable('time_tracking_session_segments'))) {
    await knex.schema.createTable('time_tracking_session_segments', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('segment_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('session_id').notNullable();
      table.timestamp('started_at', { useTz: true }).notNullable();
      table.timestamp('ended_at', { useTz: true }).nullable();
      table.primary(['tenant', 'segment_id']);
      table.index(['tenant', 'session_id'], 'time_tracking_session_segments_session_idx');
    });
    await knex.raw(`
      ALTER TABLE time_tracking_session_segments
      ADD CONSTRAINT time_tracking_session_segments_span_check
      CHECK (ended_at IS NULL OR ended_at >= started_at)
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX time_tracking_session_segments_one_open_uq
      ON time_tracking_session_segments (tenant, session_id) WHERE ended_at IS NULL
    `);
  }

  // Distribute before FKs - Citus requires both sides distributed first.
  for (const t of ['time_tracking_sessions', 'time_tracking_session_segments']) {
    await ensureTenantDistribution(knex, t);
  }

  await addForeignKeyIfMissing(knex, 'time_tracking_sessions_user_fkey', `
    ALTER TABLE time_tracking_sessions
      ADD CONSTRAINT time_tracking_sessions_user_fkey
      FOREIGN KEY (tenant, user_id) REFERENCES users(tenant, user_id)
  `);
  await addForeignKeyIfMissing(knex, 'time_tracking_session_segments_session_fkey', `
    ALTER TABLE time_tracking_session_segments
      ADD CONSTRAINT time_tracking_session_segments_session_fkey
      FOREIGN KEY (tenant, session_id) REFERENCES time_tracking_sessions(tenant, session_id) ON DELETE CASCADE
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('time_tracking_session_segments');
  await knex.schema.dropTableIfExists('time_tracking_sessions');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
