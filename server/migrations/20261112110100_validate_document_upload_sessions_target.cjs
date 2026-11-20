'use strict';

/**
 * document_upload_sessions — validates the both-or-neither target CHECK that 20261112110000 added
 * NOT VALID (alga-2026-0002891).
 *
 * Runs outside a transaction: VALIDATE scans under SHARE UPDATE EXCLUSIVE while reads and writes
 * continue. Idempotent: a validated constraint is left alone.
 */
exports.config = { transaction: false };

const TABLE = 'document_upload_sessions';
const CHECK = 'document_upload_sessions_target_both_or_neither';

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
  // A validated constraint is not un-validated; 20261112110000's down removes the constraint.
};
