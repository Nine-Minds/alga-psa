const { validateWidenedCheck, promoteWidenedCheck } = require('./utils/widenCheckIn.cjs');

// CM L6a2 (3 of 5): steps 2 and 3. VALIDATE the replacement (one scan under SHARE UPDATE
// EXCLUSIVE, reads and writes continue), then drop the old constraint and rename the replacement
// into its place. The drop never precedes a successful validate. Idempotent.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  const spec = { table: 'time_entries', name: 'time_entries_work_item_type_check' };
  await validateWidenedCheck(knex, spec);
  await promoteWidenedCheck(knex, spec);
};

exports.down = async function down() {
  // Forward-only: a validated constraint is not un-validated, and the wider list is a superset.
};
