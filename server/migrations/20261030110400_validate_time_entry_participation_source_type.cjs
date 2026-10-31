const { validateWidenedCheck, promoteWidenedCheck } = require('./utils/widenCheckIn.cjs');

// CM L6a2 (5 of 5): VALIDATE, then drop the old source_type CHECK and rename the replacement.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  const spec = { table: 'co_managed_participation_evidence', name: 'co_managed_participation_evidence_source_type_check' };
  await validateWidenedCheck(knex, spec);
  await promoteWidenedCheck(knex, spec);
};

exports.down = async function down() {
  // Forward-only.
};
