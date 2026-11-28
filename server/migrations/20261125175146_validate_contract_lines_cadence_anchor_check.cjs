'use strict';

/**
 * Validates contract_lines_cadence_anchor_check, added NOT VALID by
 * 20261125175145_add_cadence_anchor_to_contract_lines so the add does not scan
 * the table under an exclusive lock.
 */
exports.up = async function up(knex) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'contract_lines_cadence_anchor_check' AND NOT convalidated
    ) AS pending`,
  );
  if (!result.rows?.[0]?.pending) return;
  await knex.raw('ALTER TABLE contract_lines VALIDATE CONSTRAINT contract_lines_cadence_anchor_check');
};

exports.down = async function down() {};

// Citus-distributed table DDL must not run inside a transaction.
exports.config = { transaction: false };
