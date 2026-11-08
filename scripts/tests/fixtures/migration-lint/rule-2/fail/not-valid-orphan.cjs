// Rule 2 (red): NOT VALID with no VALIDATE CONSTRAINT anywhere in the change.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_orphan_check');
  // lint-expect: 2
  await knex.raw('ALTER TABLE time_entries ADD CONSTRAINT time_entries_orphan_check CHECK (work_hours >= 0) NOT VALID');
};
