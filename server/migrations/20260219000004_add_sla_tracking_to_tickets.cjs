/**
 * Add SLA tracking columns to tickets table and remove legacy unused fields
 *
 * This migration:
 * 1. Adds comprehensive SLA tracking fields for:
 *    - SLA policy assignment
 *    - Response SLA tracking (first response time)
 *    - Resolution SLA tracking (time to close)
 *    - Pause tracking (for status-based and awaiting-client pauses)
 *
 * 2. Removes legacy ITIL/SLA fields that were added but never used:
 *    - resolution_code, root_cause, workaround, related_problem_id
 *    - sla_target, sla_breach (superseded by new tracking fields)
 *    (escalated, escalation_level, escalated_at, escalated_by are kept for the escalation service)
 *
 * These legacy fields were added in migration 20250910120000_add_itil_fields_to_tickets.cjs
 * but were never implemented in the UI or business logic.
 */

exports.up = async function(knex) {
  console.log('Adding SLA tracking columns to tickets table...');

  // First, drop indexes on legacy columns that we're removing
  await knex.raw(`DROP INDEX IF EXISTS tickets_sla_breach_index`);

  // =========================================================================
  // ADD: New comprehensive SLA tracking fields (each checked individually)
  // =========================================================================
  const newColumns = [
    { name: 'sla_policy_id', sql: 'uuid' },
    { name: 'sla_started_at', sql: 'timestamptz' },
    { name: 'sla_response_due_at', sql: 'timestamptz' },
    { name: 'sla_response_at', sql: 'timestamptz' },
    { name: 'sla_response_met', sql: 'boolean' },
    { name: 'sla_resolution_due_at', sql: 'timestamptz' },
    { name: 'sla_resolution_at', sql: 'timestamptz' },
    { name: 'sla_resolution_met', sql: 'boolean' },
    { name: 'sla_paused_at', sql: 'timestamptz' },
    { name: 'sla_total_pause_minutes', sql: 'integer NOT NULL DEFAULT 0' },
  ];
  for (const col of newColumns) {
    if (!(await knex.schema.hasColumn('tickets', col.name))) {
      await knex.raw(`ALTER TABLE tickets ADD COLUMN ${col.name} ${col.sql}`);
    }
  }

  // Create indexes for common queries
  await knex.raw(`CREATE INDEX IF NOT EXISTS tickets_sla_policy_id_index ON tickets (sla_policy_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS tickets_sla_response_due_at_index ON tickets (sla_response_due_at)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS tickets_sla_resolution_due_at_index ON tickets (sla_resolution_due_at)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS tickets_sla_paused_at_index ON tickets (sla_paused_at)`);

  // =========================================================================
  // DROP: Legacy unused ITIL/SLA fields
  // =========================================================================
  const legacyColumns = ['resolution_code', 'root_cause', 'workaround', 'related_problem_id', 'sla_target', 'sla_breach'];
  for (const col of legacyColumns) {
    if (await knex.schema.hasColumn('tickets', col)) {
      await knex.raw(`ALTER TABLE tickets DROP COLUMN ${col}`);
    }
  }

  // Ensure escalation columns exist (they may have been dropped by an earlier
  // version of this migration). Using raw SQL with IF NOT EXISTS to be idempotent.
  const escalationCols = [
    { name: 'escalated', sql: 'boolean DEFAULT false' },
    { name: 'escalation_level', sql: 'integer' },
    { name: 'escalated_at', sql: 'timestamptz' },
    { name: 'escalated_by', sql: 'uuid' },
  ];
  for (const col of escalationCols) {
    if (!(await knex.schema.hasColumn('tickets', col.name))) {
      await knex.raw(`ALTER TABLE tickets ADD COLUMN ${col.name} ${col.sql}`);
      console.log(`  Restored missing column: ${col.name}`);
    }
  }

  // Ensure escalation_level check constraint exists
  await knex.raw(`
    DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'tickets_escalation_level_check'
            AND conrelid = 'tickets'::regclass
        ) THEN
            ALTER TABLE tickets
            ADD CONSTRAINT tickets_escalation_level_check
            CHECK (escalation_level IS NULL OR (escalation_level >= 1 AND escalation_level <= 3));
        END IF;
    END $$;
  `);

  // Add composite foreign key for sla_policy_id (must reference tenant + sla_policy_id)
  await knex.raw(`
    DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tickets_sla_policy_fkey'
        ) THEN
            ALTER TABLE tickets
            ADD CONSTRAINT tickets_sla_policy_fkey
            FOREIGN KEY (tenant, sla_policy_id)
            REFERENCES sla_policies(tenant, sla_policy_id);
        END IF;
    END $$;
  `);

  console.log('SLA tracking columns added and legacy fields removed from tickets table');
};

exports.down = async function(knex) {
  console.log('Removing SLA tracking columns and restoring legacy fields...');

  // Drop foreign key constraint first
  await knex.raw(`
    ALTER TABLE tickets
    DROP CONSTRAINT IF EXISTS tickets_sla_policy_fkey
  `);

  await knex.schema.alterTable('tickets', (table) => {
    // =========================================================================
    // DROP: New SLA tracking fields
    // =========================================================================

    // Drop indexes first
    table.dropIndex(['sla_policy_id']);
    table.dropIndex(['sla_response_due_at']);
    table.dropIndex(['sla_resolution_due_at']);
    table.dropIndex(['sla_paused_at']);

    // Drop new columns
    table.dropColumn('sla_total_pause_minutes');
    table.dropColumn('sla_paused_at');
    table.dropColumn('sla_resolution_met');
    table.dropColumn('sla_resolution_at');
    table.dropColumn('sla_resolution_due_at');
    table.dropColumn('sla_response_met');
    table.dropColumn('sla_response_at');
    table.dropColumn('sla_response_due_at');
    table.dropColumn('sla_started_at');
    table.dropColumn('sla_policy_id');

    // =========================================================================
    // RESTORE: Legacy ITIL/SLA fields (from migration 20250910120000)
    // =========================================================================

    // Problem management fields
    table.text('resolution_code').nullable();
    table.text('root_cause').nullable();
    table.text('workaround').nullable();
    table.uuid('related_problem_id').nullable();

    // Legacy SLA fields
    table.string('sla_target', 255).nullable();
    table.boolean('sla_breach').defaultTo(false);
  });

  // Restore escalation columns only if missing (they may already exist if the
  // up migration kept them or the self-healing code re-added them)
  const escalationCols = [
    { name: 'escalated', sql: 'boolean DEFAULT false' },
    { name: 'escalation_level', sql: 'integer' },
    { name: 'escalated_at', sql: 'timestamptz' },
    { name: 'escalated_by', sql: 'uuid' },
  ];
  for (const col of escalationCols) {
    const exists = await knex.raw(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tickets' AND column_name = ?
    `, [col.name]);
    if (exists.rows.length === 0) {
      await knex.raw(`ALTER TABLE tickets ADD COLUMN ${col.name} ${col.sql}`);
      console.log(`  Restored missing column: ${col.name}`);
    }
  }

  // Restore indexes on legacy columns
  await knex.schema.alterTable('tickets', (table) => {
    table.index(['sla_breach']);
  });

  for (const colName of ['escalated', 'escalation_level']) {
    const idxExists = await knex.raw(`
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'tickets' AND indexname = ?
    `, [`tickets_${colName}_index`]);
    if (idxExists.rows.length === 0) {
      await knex.raw(`CREATE INDEX tickets_${colName}_index ON tickets (${colName})`);
    }
  }

  // Restore check constraint if missing
  const checkExists = await knex.raw(`
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tickets_escalation_level_check'
    AND conrelid = 'tickets'::regclass
  `);
  if (checkExists.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE tickets
      ADD CONSTRAINT tickets_escalation_level_check
      CHECK (escalation_level IS NULL OR (escalation_level >= 1 AND escalation_level <= 3))
    `);
  }

  console.log('SLA tracking columns removed and legacy fields restored');
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
