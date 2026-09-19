/**
 * Ad-hoc prepaid hour blocks: immutable `source_type` column (2026-08-15)
 *
 * `source_type` ('purchase' | 'grant') records the block's origin at mint time,
 * independent of the live `source_invoice_id` link. The link is deliberately
 * cleared when a draft purchase invoice is deleted (the block is voided and
 * detached by the invoiceModification hook), so `source_invoice_id` alone
 * cannot distinguish "purchase whose invoice was deleted" from a true direct
 * grant. The column is immutable — written once at creation and never cleared.
 *
 * Backfill order (existing rows only, dev/staging data):
 *   1. blocks with an audit trail proving a purchase (a `purchase` audit row,
 *      or a `void` row written by draft-invoice deletion);
 *   2. blocks with a live `source_invoice_id` link (pending/active purchases).
 * Anything else is a direct grant.
 */

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('hour_blocks', 'source_type');
  if (!hasColumn) {
    await knex.schema.alterTable('hour_blocks', (table) => {
      table.string('source_type', 16).notNullable().defaultTo('grant')
        .comment("Block origin — 'purchase' (via invoice) or 'grant' (comped hours). Immutable; survives source_invoice_id being cleared on draft-invoice deletion.");
    });

    await knex.raw(`
      UPDATE hour_blocks hb SET source_type = 'purchase'
      FROM (
        SELECT DISTINCT tenant, block_id
        FROM hour_block_audit
        WHERE type = 'purchase'
           OR (type = 'void' AND reason = 'Draft purchase invoice deleted')
      ) src
      WHERE hb.tenant = src.tenant AND hb.block_id = src.block_id
    `);

    await knex.raw(`
      UPDATE hour_blocks SET source_type = 'purchase'
      WHERE source_invoice_id IS NOT NULL
    `);

    await knex.raw(`
      ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_source_type_check
      CHECK (source_type IN ('purchase', 'grant'))
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE hour_blocks DROP CONSTRAINT IF EXISTS hour_blocks_source_type_check');
  await knex.schema.alterTable('hour_blocks', (table) => {
    table.dropColumn('source_type');
  });
};

// ALTER TABLE on a (potentially Citus-distributed) table follows the existing
// hour-block migration convention.
exports.config = { transaction: false };
