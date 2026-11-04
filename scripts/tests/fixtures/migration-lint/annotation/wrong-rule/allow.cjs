exports.up = async function (knex) {
  // migration-lint: allow 1 - this annotation names the wrong rule for the finding below
  await knex.raw('ALTER TABLE time_entries ALTER COLUMN end_time SET NOT NULL');
};
