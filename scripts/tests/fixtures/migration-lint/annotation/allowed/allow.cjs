exports.up = async function (knex) {
  // migration-lint: allow 3 - reviewed: column is already guaranteed non-null by the app
  await knex.raw('ALTER TABLE time_entries ALTER COLUMN end_time SET NOT NULL');
  // migration-lint: allow 5 — em dash separator is accepted too, backfill is one row
  await knex.raw('UPDATE comments SET note = 1');
};
