exports.up = async function (knex) {
  // migration-lint: allow 3 - ok
  await knex.raw('ALTER TABLE time_entries ALTER COLUMN end_time SET NOT NULL');
};
