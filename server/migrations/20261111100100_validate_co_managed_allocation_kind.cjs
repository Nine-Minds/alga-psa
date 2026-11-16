/**
 * Co-managed seat and workspace shapes on one seat pool, slice S1 (F003), second half.
 *
 * Validates the kind-aware CHECKs that 20261111100000 added NOT VALID, and builds the index
 * that allows one live seat allocation per sponsor client. Both steps run outside a
 * transaction: VALIDATE scans under SHARE UPDATE EXCLUSIVE while reads and writes continue,
 * and the index is built CONCURRENTLY.
 *
 * "Live" means the same as in `co_managed_one_live_allocation`: any state but `released`.
 * The index leads with `tenant`, the distribution column, as Citus requires of a unique index.
 *
 * Idempotent: a validated constraint and a valid index are left alone. An index left INVALID
 * by an interrupted concurrent build is dropped and rebuilt, since IF NOT EXISTS would
 * otherwise accept it and the uniqueness rule would silently not hold.
 */
exports.config = { transaction: false };

const TABLE = 'co_managed_allocations';
const CHECKS = ['co_managed_allocations_kind_check', 'co_managed_allocations_kind_target_check'];
const LIVE_SEAT_INDEX = 'co_managed_one_live_seat_allocation';

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  for (const check of CHECKS) {
    const { rows } = await knex.raw(
      `SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
      [check, TABLE]
    );
    if (rows.length > 0 && !rows[0].convalidated) {
      await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${check}`);
    }
  }

  if (!(await knex.schema.hasColumn(TABLE, 'allocation_kind'))) return;
  const { rows: invalid } = await knex.raw(
    `SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(?) AND NOT indisvalid`,
    [LIVE_SEAT_INDEX]
  );
  if (invalid.length > 0) await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${LIVE_SEAT_INDEX}`);
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${LIVE_SEAT_INDEX}
      ON ${TABLE} (tenant, sponsor_client_id)
      WHERE allocation_kind = 'seat' AND state <> 'released'
  `);
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  // A validated constraint is not un-validated; 20261111100000's down removes the constraints.
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${LIVE_SEAT_INDEX}`);
};
