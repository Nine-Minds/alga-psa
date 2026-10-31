const { addWidenedCheckNotValid } = require('./utils/widenCheckIn.cjs');

// CM L6a2 (4 of 5): the participation marker. Retained participation evidence may now be sourced
// from a completed MSP time entry ('time_entry'). Same three-step widening as time_entries:
// this file adds the replacement NOT VALID from the live definition (so L4a's later sources
// survive); 20261030110400 validates, drops the old, renames.
const TABLE = 'co_managed_participation_evidence';
const NAME = 'co_managed_participation_evidence_source_type_check';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  await addWidenedCheckNotValid(knex, { table: TABLE, name: NAME, column: 'source_type', add: ['time_entry'] });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${NAME}_v2`);
};
