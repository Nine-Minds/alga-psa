/**
 * time_tracking_session_entries (2026-11-16): links a stopwatch session to every time entry it
 * produced. A session that crosses midnight is logged as one entry per work day, so the single
 * time_tracking_sessions.time_entry_id column (kept as the first entry) can no longer record it.
 *
 * Design: docs/plans/2026-11-16-ticket-timer-midnight-split-plan.md section 2.4.
 * Distributed and colocated the same way as time_tracking_session_segments
 * (20261009120000_create_time_tracking_sessions.cjs): created empty, distributed before the FKs.
 */
const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

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
  if (!(await knex.schema.hasTable('time_tracking_session_entries'))) {
    await knex.schema.createTable('time_tracking_session_entries', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('session_id').notNullable();
      table.uuid('entry_id').notNullable();
      table.primary(['tenant', 'session_id', 'entry_id']);
      table.index(['tenant', 'entry_id'], 'time_tracking_session_entries_entry_idx');
    });
  }

  await ensureTenantDistribution(knex, 'time_tracking_session_entries');

  await addForeignKeyIfMissing(knex, 'time_tracking_session_entries_session_fkey', `
    ALTER TABLE time_tracking_session_entries
      ADD CONSTRAINT time_tracking_session_entries_session_fkey
      FOREIGN KEY (tenant, session_id) REFERENCES time_tracking_sessions(tenant, session_id) ON DELETE CASCADE
  `);
  // time_entries may be distributed differently from this table; the helper skips the FK when it
  // cannot be enforced instead of failing the migration.
  await ensureCompositeFk(knex, {
    table: 'time_tracking_session_entries',
    constraint: 'time_tracking_session_entries_entry_fkey',
    columns: ['tenant', 'entry_id'],
    referencedTable: 'time_entries',
    referencedColumns: ['tenant', 'entry_id'],
    onDelete: 'CASCADE',
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('time_tracking_session_entries');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
