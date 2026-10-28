// Rule 3 (red): SET NOT NULL, ALTER TYPE, DROP COLUMN on existing tables.
exports.up = async function (knex) {
  // lint-expect: 3
  await knex.raw('ALTER TABLE time_entries ALTER COLUMN end_time SET NOT NULL');
  // lint-expect: 3
  await knex.raw('ALTER TABLE time_entries ALTER COLUMN note TYPE varchar(10)');
  // lint-expect: 3
  await knex.raw('ALTER TABLE time_entries DROP COLUMN IF EXISTS legacy');
  // lint-expect: 3
  await knex.raw('DROP TABLE IF EXISTS comments');
};
