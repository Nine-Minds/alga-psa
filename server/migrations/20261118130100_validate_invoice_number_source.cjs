'use strict';

/**
 * Xero-assigned invoice numbers (alga-2026-0002746): validates the
 * `invoice_number_source` CHECK that 20261118130000 added NOT VALID.
 *
 * Runs outside a transaction: VALIDATE scans under SHARE UPDATE EXCLUSIVE while reads and writes
 * continue. Idempotent: a validated constraint is left alone.
 */
exports.config = { transaction: false };

const TABLE = 'invoices';
const CHECK = 'invoices_invoice_number_source_check';

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
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
  // A validated constraint is not un-validated; 20261118130000's down removes the constraint.
};
