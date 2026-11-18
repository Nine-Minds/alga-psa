/**
 * Service principals (slice A / F001, PRD R1.1, R9.1):
 * widen users.user_type so it accepts 'service' in addition to 'internal' | 'client'.
 *
 * The constraint `users_user_type_check` was created by the knex `enu()` in
 * server/migrations/20241116000000_add_user_type_to_users.cjs. This is an EE-only
 * migration on purpose: the CE schema keeps rejecting 'service'.
 *
 * Citus-safe order: DROP CONSTRAINT, ADD CONSTRAINT ... NOT VALID, VALIDATE CONSTRAINT.
 * Each statement runs on its own (transaction: false), like other Citus DDL migrations.
 * Nothing in this slice creates a 'service' user; that arrives with the EE service
 * (card C), so widening is harmless on its own.
 *
 * @param { import("knex").Knex } knex
 */
exports.config = { transaction: false };

const CONSTRAINT = 'users_user_type_check';

async function replaceConstraint(knex, allowed) {
  const list = allowed.map((v) => `'${v}'`).join(', ');
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  // migration-lint: allow 2 - drops then re-adds the widened CHECK with NOT VALID and validates in the same file; users is tenant-scoped and the validate is a single cheap scan, merged before lint existed
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT ${CONSTRAINT} CHECK (user_type IN (${list})) NOT VALID`
  );
  await knex.raw(`ALTER TABLE users VALIDATE CONSTRAINT ${CONSTRAINT}`);
}

exports.up = async function up(knex) {
  await replaceConstraint(knex, ['internal', 'client', 'service']);
};

exports.down = async function down(knex) {
  // Restoring the narrow constraint would fail validation with an opaque error if
  // service users exist. Refuse with an actionable message instead of deleting data.
  const { rows } = await knex.raw(`SELECT count(*)::int AS n FROM users WHERE user_type = 'service'`);
  if (rows[0].n > 0) {
    throw new Error(
      `Cannot roll back ${CONSTRAINT}: ${rows[0].n} user(s) have user_type = 'service'. ` +
        `Remove or convert them before rolling back.`
    );
  }
  await replaceConstraint(knex, ['internal', 'client']);
};
