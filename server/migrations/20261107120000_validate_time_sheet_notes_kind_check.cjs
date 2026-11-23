'use strict';

// Validate separately so adding the CHECK to the existing history table stays
// catalog-only; the validation scan runs in its own migration window.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('time_sheet_notes'))) return;
  await knex.raw('ALTER TABLE time_sheet_notes VALIDATE CONSTRAINT time_sheet_notes_kind_check');
};

exports.down = async function down() {};
