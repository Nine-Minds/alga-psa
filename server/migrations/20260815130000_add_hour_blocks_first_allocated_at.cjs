/**
 * Ad-hoc prepaid hour blocks: immutable `first_allocated_at` column (2026-08-15)
 *
 * `first_allocated_at` records the instant a block was first burned by any
 * allocation (`hour_block_time_allocations` row), independent of the live
 * allocation rows. The burn ledger is reversed on time-entry delete/edit and
 * during nightly reconcile (rows deleted, `remaining_minutes` restored), so
 * "has current allocation rows" cannot answer the void guard's question — "has
 * this block EVER been used". The void lifecycle invariant is void-before-any-
 * burn; a block whose burns were fully reversed must still refuse voiding.
 *
 * The column is set once at the first allocation and never cleared by any
 * reversal or reconcile path.
 *
 * Backfill: blocks with current allocation rows get `first_allocated_at` =
 * the earliest allocation's `created_at`. Blocks whose burns were already fully
 * reversed before this migration are unrecoverable (their data no longer
 * exists) and stay NULL — accepted, documented limitation.
 */

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('hour_blocks', 'first_allocated_at');
  if (!hasColumn) {
    await knex.schema.alterTable('hour_blocks', (table) => {
      table.timestamp('first_allocated_at', { useTz: true }).nullable()
        .comment('Set once at the first allocation ever recorded against the block and NEVER cleared — survives reversal/reconcile so the void guard can reject any block that has ever been used.');
    });

    await knex.raw(`
      UPDATE hour_blocks hb
      SET first_allocated_at = earliest.created_at
      FROM (
        SELECT tenant, block_id, MIN(created_at) AS created_at
        FROM hour_block_time_allocations
        GROUP BY tenant, block_id
      ) earliest
      WHERE hb.tenant = earliest.tenant AND hb.block_id = earliest.block_id
    `);
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('hour_blocks', (table) => {
    table.dropColumn('first_allocated_at');
  });
};

// ALTER TABLE on a (potentially Citus-distributed) table follows the existing
// hour-block migration convention.
exports.config = { transaction: false };
