/**
 * Per-device push priority threshold (mobile task 35.9.2).
 *
 * A device only receives push for notifications whose stamped priority is at
 * or above its threshold: 'low' (default, everything), 'normal', or 'high'.
 * The in-app notification itself is unaffected — this only gates delivery to
 * that phone. Set by the mobile Settings screen through the push-token route.
 *
 * Citus: ADD COLUMN propagates to shards on its own; the CHECK must be a
 * separate, named statement (inline CHECK on ADD COLUMN is rejected).
 */
const TABLE = 'mobile_push_tokens';
const COLUMN = 'push_priority_threshold';
const CONSTRAINT = 'mobile_push_tokens_push_priority_threshold_ck';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasColumn(TABLE, COLUMN);
  if (!exists) {
    await knex.raw(`ALTER TABLE ?? ADD COLUMN ?? text NOT NULL DEFAULT 'low'`, [TABLE, COLUMN]);
  }
  const constraint = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
    [CONSTRAINT, TABLE],
  );
  if (constraint.rows.length === 0) {
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (?? IN ('low','normal','high'))`, [TABLE, CONSTRAINT, COLUMN]);
  }
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [TABLE, CONSTRAINT]);
  await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ??', [TABLE, COLUMN]);
};
