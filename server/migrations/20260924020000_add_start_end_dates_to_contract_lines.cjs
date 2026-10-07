'use strict';

/**
 * Authored start/end dates for a contract line.
 *
 * A line bills for the whole life of its client-contract assignment today
 * (`client_contracts.start_date`/`end_date`). Operators need to bound a single
 * line inside that assignment without ending the whole contract. The columns are
 * nullable and half-open (`[start_date, end_date)`), matching the contract
 * assignment convention; a null bound inherits the assignment bound. Authored
 * values are constrained to the assignment period by the server actions, and the
 * billing engine/proration skip a line outside its window.
 */

const TABLE = 'contract_lines';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (!(await knex.schema.hasColumn(TABLE, 'start_date'))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN start_date date`);
  }
  if (!(await knex.schema.hasColumn(TABLE, 'end_date'))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN end_date date`);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (await knex.schema.hasColumn(TABLE, 'end_date')) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN end_date`);
  }
  if (await knex.schema.hasColumn(TABLE, 'start_date')) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN start_date`);
  }
};

// Citus-distributed table DDL must not run inside a transaction.
exports.config = { transaction: false };
