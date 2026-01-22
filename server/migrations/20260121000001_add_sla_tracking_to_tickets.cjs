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
 *    - escalated, escalation_level, escalated_at, escalated_by
 *
 * These legacy fields were added in migration 20250910120000_add_itil_fields_to_tickets.cjs
 * but were never implemented in the UI or business logic.
 */

exports.up = async function(knex) {
  console.log('Adding SLA tracking columns to tickets table...');

  // First, drop indexes on legacy columns that we're removing
  await knex.schema.alterTable('tickets', (table) => {
    // These indexes may or may not exist depending on environment
    try {
      table.dropIndex(['sla_breach']);
    } catch (e) {
      // Index may not exist
    }
    try {
      table.dropIndex(['escalated']);
    } catch (e) {
      // Index may not exist
    }
    try {
      table.dropIndex(['escalation_level']);
    } catch (e) {
      // Index may not exist
    }
  }).catch(() => {
    // Ignore errors if indexes don't exist
  });

  await knex.schema.alterTable('tickets', (table) => {
    // =========================================================================
    // ADD: New comprehensive SLA tracking fields
    // =========================================================================

    // SLA Policy assignment (foreign key added separately via raw SQL for composite key)
    table.uuid('sla_policy_id')
      .nullable()
      .comment('The SLA policy applied to this ticket');

    table.timestamp('sla_started_at', { useTz: true })
      .nullable()
      .comment('When the SLA clock started (usually ticket creation time)');

    // Response SLA tracking
    table.timestamp('sla_response_due_at', { useTz: true })
      .nullable()
      .comment('When the first response is due (calculated from policy)');

    table.timestamp('sla_response_at', { useTz: true })
      .nullable()
      .comment('When the first meaningful response was made');

    table.boolean('sla_response_met')
      .nullable()
      .comment('Whether the response SLA was met (null = not yet responded)');

    // Resolution SLA tracking
    table.timestamp('sla_resolution_due_at', { useTz: true })
      .nullable()
      .comment('When resolution is due (calculated from policy)');

    table.timestamp('sla_resolution_at', { useTz: true })
      .nullable()
      .comment('When the ticket was resolved/closed');

    table.boolean('sla_resolution_met')
      .nullable()
      .comment('Whether the resolution SLA was met (null = not yet resolved)');

    // Pause tracking
    table.timestamp('sla_paused_at', { useTz: true })
      .nullable()
      .comment('When the SLA was paused (null = not paused)');

    table.integer('sla_total_pause_minutes')
      .defaultTo(0)
      .notNullable()
      .comment('Cumulative pause time in minutes (carries across multiple pauses)');

    // Indexes for common queries
    table.index(['sla_policy_id']);
    table.index(['sla_response_due_at']);
    table.index(['sla_resolution_due_at']);
    table.index(['sla_paused_at']);

    // =========================================================================
    // DROP: Legacy unused ITIL/SLA fields
    // =========================================================================

    // Problem management fields (never implemented)
    table.dropColumn('resolution_code');
    table.dropColumn('root_cause');
    table.dropColumn('workaround');
    table.dropColumn('related_problem_id');

    // Legacy SLA fields (superseded by new tracking)
    table.dropColumn('sla_target');
    table.dropColumn('sla_breach');

    // Legacy escalation fields (never implemented)
    table.dropColumn('escalated');
    table.dropColumn('escalation_level');
    table.dropColumn('escalated_at');
    table.dropColumn('escalated_by');
  });

  // Add composite foreign key for sla_policy_id (must reference tenant + sla_policy_id)
  await knex.raw(`
    ALTER TABLE tickets
    ADD CONSTRAINT tickets_sla_policy_fkey
    FOREIGN KEY (tenant, sla_policy_id)
    REFERENCES sla_policies(tenant, sla_policy_id)
    ON DELETE SET NULL
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

    // Legacy escalation fields
    table.boolean('escalated').defaultTo(false);
    table.integer('escalation_level').nullable();
    table.timestamp('escalated_at', { useTz: true }).nullable();
    table.uuid('escalated_by').nullable();
  });

  // Restore indexes on legacy columns
  await knex.schema.alterTable('tickets', (table) => {
    table.index(['sla_breach']);
    table.index(['escalated']);
    table.index(['escalation_level']);
  });

  // Restore check constraint
  await knex.raw(`
    ALTER TABLE tickets
    ADD CONSTRAINT tickets_escalation_level_check
    CHECK (escalation_level IS NULL OR (escalation_level >= 1 AND escalation_level <= 3))
  `);

  console.log('SLA tracking columns removed and legacy fields restored');
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
