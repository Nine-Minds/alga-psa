/**
 * Widen quote_items.tax_rate so the stored percentage is the one charged
 * (alga-2026-0002902).
 *
 * The column was integer, so a 6.875% rate was persisted — and shown to the
 * customer — as 7 while the tax amount was computed at 6.875. Widened to a
 * plain (unbounded) numeric rather than numeric(10,4): the N-1 structural
 * assertion treats any int -> bounded-numeric change as unsafe (it can't
 * prove the bound holds every int4 value), so bounded precision is reserved
 * for columns that were already numeric. Unbounded numeric still stores the
 * fractional percentage exactly. Existing integer values round-trip
 * unchanged; each quote picks up its true rate on its next recalculation,
 * so there is no backfill.
 *
 * A plain ALTER COLUMN TYPE propagates to the shards of a Citus-distributed
 * table. Idempotent (type probe) and run under the 2s lock_timeout retry.
 */
const TABLE = 'quote_items';
const LOCK_ATTEMPTS = 3;

// LEVERAGE: pattern migration-lock-retry — same savepoint/lock_timeout retry as 20261029140400; a shared migration util should own it once a third migration needs it.
async function withLockRetry(knex, statement) {
  const { rows } = await knex.raw(`SELECT current_setting('lock_timeout') AS value`);
  const prior = rows[0].value;
  const restore = () => knex.raw(`SELECT set_config('lock_timeout', ?, true)`, [prior]);
  for (let attempt = 1; ; attempt += 1) {
    await knex.raw('SAVEPOINT lock_retry');
    try {
      await knex.raw(`SET LOCAL lock_timeout = '2s'`);
      const result = await knex.raw(statement);
      await knex.raw('RELEASE SAVEPOINT lock_retry');
      await restore();
      return result;
    } catch (error) {
      try {
        await knex.raw('ROLLBACK TO SAVEPOINT lock_retry');
        await restore();
      } catch {
        throw error;
      }
      if (error.code !== '55P03' || attempt >= LOCK_ATTEMPTS) throw error;
    }
  }
}

async function taxRateDataType(knex) {
  const { rows } = await knex.raw(
    `SELECT data_type FROM information_schema.columns
      WHERE table_name = ? AND column_name = 'tax_rate' AND table_schema = current_schema()`,
    [TABLE]
  );
  return rows[0]?.data_type ?? null;
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if ((await taxRateDataType(knex)) === 'numeric') return;

  // migration-lint: allow 3 - integer to numeric rewrites quote_items, a young per-tenant table whose rows are bounded by authored quote lines; the ACCESS EXCLUSIVE lock is bounded by the 2s lock_timeout retry and no index depends on tax_rate
  await withLockRetry(knex, `ALTER TABLE ${TABLE} ALTER COLUMN tax_rate TYPE numeric`);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if ((await taxRateDataType(knex)) === 'integer') return;

  // Reverting rounds away any fractional rate stored in the meantime — exactly
  // the pre-fix behaviour this migration removes.
  await withLockRetry(knex, `ALTER TABLE ${TABLE} ALTER COLUMN tax_rate TYPE integer USING round(tax_rate)`);
};
