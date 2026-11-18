// Rule 3 (red): SET NOT NULL, ALTER TYPE, DROP COLUMN, RENAME CONSTRAINT on existing tables.
exports.up = async function (knex) {
  // lint-expect: 3
  await knex.raw('ALTER TABLE time_entries ALTER COLUMN end_time SET NOT NULL');
  // lint-expect: 3
  await knex.raw('ALTER TABLE time_entries ALTER COLUMN note TYPE varchar(10)');
  // lint-expect: 3
  await knex.raw('ALTER TABLE time_entries DROP COLUMN IF EXISTS legacy');
  // lint-expect: 3
  await knex.raw('DROP TABLE IF EXISTS comments');
  // lint-expect: 3
  await knex.raw('ALTER TABLE tenants RENAME CONSTRAINT tenants_product_code_check_next TO tenants_product_code_check');
};
