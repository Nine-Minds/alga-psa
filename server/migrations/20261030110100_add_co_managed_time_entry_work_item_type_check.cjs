const { addWidenedCheckNotValid } = require('./utils/widenCheckIn.cjs');

// CM L6a2 (2 of 5): time_entries.work_item_type may now be 'co_managed'. Step 1 of 3: the
// replacement CHECK is added NOT VALID (no scan) beside the old one, which keeps rejecting nothing
// an old reader writes. The allowed list is built from the live constraint, never hard-coded.
// 20261030110200 validates it and only then drops the old constraint.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  await addWidenedCheckNotValid(knex, { table: 'time_entries', name: 'time_entries_work_item_type_check', column: 'work_item_type', add: ['co_managed'] });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('time_entries'))) return;
  await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_work_item_type_check_v2');
};
