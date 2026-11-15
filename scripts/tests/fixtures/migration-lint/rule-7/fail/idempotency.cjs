// Rule 7 (red): DDL without an idempotency guard.
exports.up = async function (knex) {
  // lint-expect: 7
  await knex.raw('ALTER TABLE comments ADD COLUMN extra int');
  // lint-expect: 7
  await knex.raw('CREATE TABLE audit_log (id int)');
  // lint-expect: 7
  await knex.raw('ALTER TABLE audit_log ADD CONSTRAINT audit_log_pk_like UNIQUE (id)');
};
