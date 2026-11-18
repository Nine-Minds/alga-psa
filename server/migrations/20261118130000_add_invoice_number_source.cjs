/**
 * Records who owns each invoice's number (alga-2026-0002746).
 *
 *   alga             - Alga's number is the number of record (every existing row).
 *   pending_external - the number is provisional, waiting for the accounting
 *                      system (Xero) to assign the real one.
 *   external         - the number came back from the accounting system and was
 *                      written onto the invoice.
 *
 * Citus-safe: a constant DEFAULT with NOT NULL is a metadata-only add on the
 * distributed table; the CHECK constraint is added separately and is
 * idempotent so a re-run is harmless.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('invoices', 'invoice_number_source');
  if (!hasColumn) {
    await knex.schema.alterTable('invoices', (table) => {
      table.text('invoice_number_source').notNullable().defaultTo('alga');
    });
  }

  const { rows } = await knex.raw(
    "SELECT 1 FROM pg_constraint WHERE conname = 'invoices_invoice_number_source_check' AND conrelid = 'invoices'::regclass LIMIT 1",
  );
  if (rows.length === 0) {
    await knex.raw(`
      ALTER TABLE invoices
      ADD CONSTRAINT invoices_invoice_number_source_check
      CHECK (invoice_number_source IN ('alga', 'pending_external', 'external'))
    `);
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_source_check');
  const hasColumn = await knex.schema.hasColumn('invoices', 'invoice_number_source');
  if (hasColumn) {
    await knex.schema.alterTable('invoices', (table) => {
      table.dropColumn('invoice_number_source');
    });
  }
};
