'use strict';

/**
 * Co-managed seat and workspace shapes, slice S10: validates the `ended_reason` CHECK that
 * 20261114060000 added NOT VALID.
 *
 * Runs outside a transaction: VALIDATE scans under SHARE UPDATE EXCLUSIVE while reads and writes
 * continue. Idempotent: a validated constraint is left alone.
 */
exports.config = { transaction: false };

const TABLE = 'co_managed_seat_assignments';
const CHECK = 'co_managed_seat_assignments_ended_reason_check';

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const { rows } = await knex.raw(
    `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
    [CHECK, TABLE]
  );
  if (rows.length > 0 && !rows[0].convalidated) {
    await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${CHECK}`);
  }
};

/** @param { import("knex").Knex } knex */
exports.down = async function down() {
  // A validated constraint is not un-validated; 20261114060000's down removes the constraint.
};
