'use strict';

/**
 * `boards.display_itil_impact` and `boards.display_itil_urgency` are dropped —
 * `ee/plans/2026-11-21-itil-remediation` (F134).
 *
 * They were written by board create and by the dev seed and read by nothing: whether a ticket form
 * shows Impact and Urgency follows from the board's `priority_type` (R4), not from a column an
 * admin never saw. The board schemas still *accept* both keys so an older client's payload is not
 * rejected; the values reach nothing.
 *
 * No other column, row or board setting is touched.
 *
 * Citus: `transaction: false`, and `ALTER TABLE … DROP COLUMN` propagates to the shards.
 * Idempotent: a second run finds the columns gone.
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('boards'))) return;

  for (const column of ['display_itil_impact', 'display_itil_urgency']) {
    if (await knex.schema.hasColumn('boards', column)) {
      await knex.schema.alterTable('boards', (table) => {
        // migration-lint: allow R3 - nothing reads these columns; down() restores them with their default
        table.dropColumn(column);
      });
    }
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('boards'))) return;

  // Restored with their original default so a rollback leaves the shape the old code expects.
  for (const column of ['display_itil_impact', 'display_itil_urgency']) {
    if (!(await knex.schema.hasColumn('boards', column))) {
      await knex.schema.alterTable('boards', (table) => {
        table.boolean(column).defaultTo(false);
      });
    }
  }
};
