/**
 * The hour_blocks -> invoices FK was originally declared with a bare
 * ON DELETE SET NULL on the composite (tenant, source_invoice_id) key, which
 * nulls BOTH columns on invoice deletion — including NOT NULL tenant — and
 * which Citus refuses outright when the distribution key is part of the FK
 * (this is what broke the combined-migration chain on single-node Citus).
 * Recreate it safely:
 * - PG 15+ on plain Postgres: ON DELETE SET NULL (source_invoice_id) — keeps
 *   tenant and nulls only the link column.
 * - Citus (or PG < 15): plain NO ACTION. Safe because draft-invoice deletion
 *   detaches source_invoice_id in the app first
 *   (voidPendingHourBlocksForDeletedInvoice in invoiceModification.ts) and
 *   tenant deletion removes hour_blocks before invoices.
 * Same recipe as 20260719120000_fix_suppression_contact_fk_set_null.cjs.
 *
 * On a fresh chain 20260813120000 already creates the FK in this exact form
 * and this migration is a drop/re-add no-op; it remains for databases that
 * ran the original bare-SET NULL version of that migration.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const citusRow = await knex.raw(
    "SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1",
  );
  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const columnTargeted = versionRow.rows[0].v >= 150000 && citusRow.rows.length === 0;

  await knex.raw(`
    ALTER TABLE hour_blocks
    DROP CONSTRAINT IF EXISTS hour_blocks_invoice_fkey
  `);
  await knex.raw(`
    ALTER TABLE hour_blocks
    ADD CONSTRAINT hour_blocks_invoice_fkey
    FOREIGN KEY (tenant, source_invoice_id)
    REFERENCES invoices(tenant, invoice_id)${columnTargeted ? ' ON DELETE SET NULL (source_invoice_id)' : ''}
  `);
};

/**
 * Intentionally a no-op: restoring the bare composite SET NULL would
 * reintroduce the tenant-nulling hazard (and Citus rejects it outright).
 *
 * @returns {Promise<void>}
 */
exports.down = async function down() {};
