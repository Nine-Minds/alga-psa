/**
 * A bundle revision is published open (a deny-list of narrowing rules, today's behaviour) or closed
 * (an allow-list: a resource/action the revision has no rule for is denied).
 *
 * Additive only: every existing row becomes 'open'. Constant default, no trigger, no volatile function,
 * so it is safe on the distributed table.
 */
const TABLE = 'authorization_bundle_revisions';
const CHECK = 'authorization_bundle_revisions_baseline_check';

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS baseline text NOT NULL DEFAULT 'open'`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CHECK}`);
  await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK} CHECK (baseline IN ('open', 'closed'))`);
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CHECK}`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS baseline`);
};
