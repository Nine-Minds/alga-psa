'use strict';

/**
 * time_sheet_notes — the submission / approval history of a time sheet (alga-2026-0002763).
 *
 * The REST time-sheet write paths used to write submission_notes / approval_notes / change_reason /
 * reversal_reason onto time_sheets, which has none of those columns (Postgres 42703, surfaced as
 * INTERNAL_CONFIGURATION). Per the product decision, those notes live in this append-only history
 * table instead; time_sheets keeps only its real columns.
 *
 *   kind    submission | approval | request_changes | reverse_approval
 *   note    the free-text note / reason (nullable: submission and approval notes are optional)
 *   detail  secondary text (request_changes' detailed_feedback)
 *
 * Citus: new table, no pre-existing rows. Primary key and index include the distribution column
 * (`tenant`); composite foreign keys are added after distribution.
 */

const TABLE = 'time_sheet_notes';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('note_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('time_sheet_id').notNullable();
      table.text('kind').notNullable();
      table.text('note').nullable();
      table.text('detail').nullable();
      table.uuid('created_by').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'note_id']);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_time_sheet
    ON ${TABLE} (tenant, time_sheet_id)
  `);

  const { ensureTenantDistribution, ensureCompositeFk, hasConstraint } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  if (!(await hasConstraint(knex, TABLE, `${TABLE}_kind_check`))) {
    await knex.raw(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${TABLE}_kind_check ` +
        `CHECK (kind IN ('submission', 'approval', 'request_changes', 'reverse_approval'))`
    );
  }

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_time_sheet_foreign`,
    columns: ['tenant', 'time_sheet_id'],
    referencedTable: 'time_sheets',
    referencedColumns: ['tenant', 'id'],
    onDelete: 'CASCADE',
  });
  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_created_by_foreign`,
    columns: ['tenant', 'created_by'],
    referencedTable: 'users',
    referencedColumns: ['tenant', 'user_id'],
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
