// Rule 7 (green): IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before ADD, and a
// preceding hasTable guard in the same function.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE comments ADD COLUMN IF NOT EXISTS extra int');
  await knex.raw('CREATE TABLE IF NOT EXISTS audit_log (id int)');
  await knex.raw('ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_id_unique');
  await knex.raw('ALTER TABLE audit_log ADD CONSTRAINT audit_log_id_unique UNIQUE (id)');
  if (!(await knex.schema.hasTable('other_log'))) {
    await knex.raw('CREATE TABLE other_log (id int)');
  }
};
